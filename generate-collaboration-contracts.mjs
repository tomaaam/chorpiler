// Temporary script to generate Solidity contracts + encodings for collaboration BPMNs
import * as fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BPMN_PATH = path.join(__dirname, "tests/input/bpmn/edgecases/shouldsucceed");
const CONTRACTS_PATH = path.join(__dirname, "tests/output/contracts");

const files = ["collaboration-simple.bpmn", "collaboration-internal.bpmn"];

const { INetFastXMLParser } = await import("./src/Parser/FastXMLParser.js");
const { default: SolDefaultContractGenerator } = await import("./src/Generator/target/Sol/DefaultGenerator.js");
const { TriggerEncoding } = await import("./src/Generator/Encoding/TriggerEncoding.js");

const parser = new INetFastXMLParser();

for (const file of files) {
  const bpmnPath = path.join(BPMN_PATH, file);
  const data = fs.readFileSync(bpmnPath);
  const iNets = await parser.fromXML(data);

  for (const iNet of iNets) {
    const generator = new SolDefaultContractGenerator(iNet);
    const result = await generator.compile({ unfoldSubNets: true, events: true, debug: true });

    const solPath = path.join(CONTRACTS_PATH, `${iNet.id}.sol`);
    const jsonPath = path.join(CONTRACTS_PATH, `${iNet.id}.json`);

    fs.writeFileSync(solPath, result.target);
    fs.writeFileSync(jsonPath, JSON.stringify(TriggerEncoding.toJSON(result.encoding), null, 2));

    console.log(`Generated: ${iNet.id}.sol`);
    console.log(`Participants:`, [...result.encoding.participants.entries()].map(([k,v]) => `${k}=${v}`));
    console.log(`Tasks:`, JSON.stringify([...result.encoding.tasks.entries()].map(([k,v]) => ({id: k, enc: v})), null, 2));
    console.log("---");
  }
}
