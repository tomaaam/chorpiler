/**
 * Compares the three participant/authorization models on-chain.
 *
 * From a single lane-annotated process diagram (process-lanes.bpmn) it generates
 * the SingleActor, Open and LaneBased contracts, deploys each to the in-memory
 * Hardhat chain, and measures:
 *   - deployment gas + deployed bytecode size
 *   - gas per task (and total) for the same happy-path trace
 *   - access-control behaviour (does an unauthorized caller revert?)
 *
 * Run with:  npm run script/compare
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import path from "path";
import { network } from "hardhat";
import { AuthorizationMode, INetFastXMLParser } from "../../../src/Parser/FastXMLParser.js";
import SolDefaultContractGenerator from "../../../src/Generator/target/Sol/DefaultGenerator.js";
import { TriggerEncoding } from "../../../src/Generator/Encoding/TriggerEncoding.js";
import { BPMN_PATH, CONTRACTS_PATH, OUTPUT_PATH } from "../../config.js";
import { enact } from "../execution-helpers.js";

const DEFAULT_PARTICIPANT_ID = "__default_participant__";

// Generated into a subfolder so the execution test (which scans only top-level
// .sol files in CONTRACTS_PATH) ignores them, while Hardhat still compiles them.
const COMPARE_DIR = path.join(CONTRACTS_PATH, "compare");

const VARIANTS = [
  { name: "process_lanes_single", mode: AuthorizationMode.SingleActor, enforce: true },
  { name: "process_lanes_open", mode: AuthorizationMode.Open, enforce: false },
  { name: "process_lanes_lane", mode: AuthorizationMode.LaneBased, enforce: true },
] as const;

// The conforming trace, expressed by (task, owning lane). The lane only matters
// for LaneBased; the other two collapse everything onto the dummy participant.
const TRACE = [
  { task: "task_request", lane: "Lane_buyer" },
  { task: "task_approve", lane: "Lane_seller" },
  { task: "task_pay", lane: "Lane_buyer" },
];

type Built = {
  name: string;
  encoding: TriggerEncoding;
  participantCount: number;
};

const artifactPath = (name: string) =>
  path.join(
    OUTPUT_PATH,
    "artifacts",
    "tests",
    "output",
    "contracts",
    "compare",
    `${name}.sol`,
    `${name}.json`,
  );

// Which wallet index must sign a given task in a given variant.
const walletIndex = (enc: TriggerEncoding, lane: string): number => {
  const source = enc.participants.has(lane) ? lane : DEFAULT_PARTICIPANT_ID;
  return enc.participants.get(source)!;
};

async function main() {
  // 1. Generate the three contracts from the same model.
  const parser = new INetFastXMLParser();
  const data = fs.readFileSync(path.join(BPMN_PATH, "process-lanes.bpmn"));
  const built: Built[] = [];
  fs.mkdirSync(COMPARE_DIR, { recursive: true });

  for (const v of VARIANTS) {
    const [iNet] = await parser.fromXML(data, v.mode);
    iNet.id = v.name; // unique contract + file name so all three coexist
    const generator = new SolDefaultContractGenerator(iNet);
    const { target, encoding } = await generator.compile({
      events: true,
      enforceAuthorization: v.enforce,
    });
    fs.writeFileSync(path.join(COMPARE_DIR, `${v.name}.sol`), target);
    fs.writeFileSync(
      path.join(COMPARE_DIR, `${v.name}.json`),
      JSON.stringify(TriggerEncoding.toJSON(encoding)),
    );
    built.push({
      name: v.name,
      encoding,
      participantCount: iNet.participants.size,
    });
  }

  // 2. Compile with Hardhat.
  console.log("Compiling generated contracts ...");
  const compile = spawnSync("npx", ["hardhat", "compile"], { stdio: "inherit" });
  if (compile.status !== 0) throw new Error("hardhat compile failed");

  // 3. Connect to the in-memory chain.
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();

  const rows: any[] = [];

  for (const b of built) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath(b.name), "utf8"));
    const abi = artifact.abi;
    const bytecode: `0x${string}` = artifact.bytecode;
    const codeSize = (String(artifact.deployedBytecode).length - 2) / 2;

    const addresses = Array.from({ length: b.participantCount }, (_, i) =>
      wallets[i].account!.address,
    );

    // --- deploy (measure deployment gas) ---
    const deployHash = await wallets[0].deployContract({
      abi,
      bytecode,
      args: [addresses],
      account: wallets[0].account!,
    } as any);
    const deployReceipt = await publicClient.waitForTransactionReceipt({
      hash: deployHash,
    });
    const contract = { address: deployReceipt.contractAddress!, abi };

    // --- happy path: gas per task ---
    const perTask: number[] = [];
    for (const step of TRACE) {
      const taskId = b.encoding.tasks.get(step.task)!.encoding;
      const idx = walletIndex(b.encoding, step.lane);
      const receipt = await enact(publicClient, wallets[idx], contract, "enact", taskId);
      perTask.push(Number(receipt!.gasUsed));
    }
    const finalState = await publicClient.readContract({
      address: contract.address,
      abi,
      functionName: "getTokenState",
    });

    // --- access control: first task signed by the WRONG wallet ---
    // These contracts do NOT revert on an unauthorized call: the sender guard is
    // simply not met, so the task is skipped (no Task event, state unchanged).
    // For SingleActor/LaneBased the task must be BLOCKED; for Open it executes.
    const probe = await viem.deployContract(b.name as string, [addresses]);
    const firstTaskId = b.encoding.tasks.get(TRACE[0].task)!.encoding;
    const wrongWallet = wallets[7]; // not participant[0] (and not the buyer lane)
    const probeReceipt = await enact(
      publicClient,
      wrongWallet,
      probe,
      "enact",
      firstTaskId,
    );
    // a Task event in the logs means the task actually executed
    const unauthorizedExecuted = (probeReceipt?.logs.length ?? 0) > 0;

    rows.push({
      model: b.name.replace("process_lanes_", ""),
      participants: b.participantCount,
      codeSize,
      deployGas: Number(deployReceipt.gasUsed),
      perTask,
      totalTaskGas: perTask.reduce((a, c) => a + c, 0),
      completed: Number(finalState) === 0,
      unauthorizedExecuted,
    });
  }

  // 4. Print the comparison table.
  console.log("\n================ Authorization model comparison ================\n");
  console.log(
    [
      "model".padEnd(12),
      "actors".padStart(7),
      "codeB".padStart(7),
      "deployGas".padStart(11),
      "gas/task (req, appr, pay)".padStart(28),
      "totalGas".padStart(9),
      "unauth call".padStart(12),
    ].join("  "),
  );
  for (const r of rows) {
    console.log(
      [
        r.model.padEnd(12),
        String(r.participants).padStart(7),
        String(r.codeSize).padStart(7),
        String(r.deployGas).padStart(11),
        r.perTask.map((g: number) => g).join(", ").padStart(28),
        String(r.totalTaskGas).padStart(9),
        (r.unauthorizedExecuted ? "executes" : "blocked").padStart(12),
      ].join("  "),
    );
  }

  const open = rows.find((r) => r.model === "open");
  const single = rows.find((r) => r.model === "single");
  if (open && single) {
    const delta = single.totalTaskGas - open.totalTaskGas;
    console.log(
      `\nCost of access control (SingleActor - Open) over ${TRACE.length} tasks: ${delta} gas` +
        ` (~${Math.round(delta / TRACE.length)} gas/task).`,
    );
  }
  console.log(
    "\nNote: 'unauth call' = first task signed by an unauthorized wallet." +
      " Blocked = task skipped (no Task event); contracts do not revert.",
  );
  console.log("===============================================================\n");
}

await main();
