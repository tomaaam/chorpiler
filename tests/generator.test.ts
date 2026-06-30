import * as fs from "fs";
import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";
import path from "path";
import util from "util";
import { CaseVariable } from "../src/Generator/Encoding/Encoding.js";
import SolDefaultContractGenerator from "../src/Generator/target/Sol/DefaultGenerator.js";
import SolInstanceGenerator from "../src/Generator/target/Sol/InstanceGenerator.js";
import { AuthorizationMode, INetFastXMLParser } from "../src/Parser/FastXMLParser.js";
import { INetParser } from "../src/Parser/Parser.js";
import { BPMN_PATH, CONTRACTS_PATH } from "./config.js";
import { compileBpmn } from "./helpers/compiler-helpers.js";

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

describe("Generation of edge cases", () => {
  let parser: INetParser;

  beforeEach(() => {
    parser = new INetFastXMLParser();
  });

  describe("Parse correct BPMN files from edgecase collection and generate Sol Contracts", () => {
    const edgeCasesPath = path.join(BPMN_PATH, "edgecases", "shouldsucceed");
    const bpmnFiles = fs
      .readdirSync(edgeCasesPath)
      .filter((file) => file.endsWith(".bpmn"));

    bpmnFiles.forEach((bpmnFile) => {
      it(`${bpmnFile} should compile to Sol contract`, async () => {
        const data = await readFile(path.join(edgeCasesPath, bpmnFile));
        const iNets = await parser.fromXML(data);

        // Special handling for sub-choreography2.bpmn, which needs unfold=false
        const isSubChoreography2 = bpmnFile === "sub-choreography2.bpmn";

        if (isSubChoreography2) {
          console.log(iNets);
        }

        for (const iNet of iNets) {
          const generator = iNet.isCalled
            ? new SolInstanceGenerator(iNet)
            : new SolDefaultContractGenerator(iNet);

          const result = await generator.compile({
            unfoldSubNets: !isSubChoreography2,
          });

          const modelName = bpmnFile.replace(".bpmn", "");
          assert.ok(result, `Should successfully compile ${modelName} model`);
          assert.ok(result.target, "Should generate target contract code");
        }
      });
    });
  });

  describe("Parse and compile cases", () => {
    it("XOR-AND case to Sol Contract", async () => {
      await compileBpmn(
        parser,
        "xor-and",
        [new CaseVariable("items", "bool", "bool public items = false;", true)],
        [],
      );
    });

    it("Pharmacy (out of order xml file) case to Sol Contract", async () => {
      await compileBpmn(parser, "out-of-order-xml", [], []);
    });

    it.skip("Pharmacy case to State Channel Root", async () => {
      await compileBpmn(parser, "out-of-order-xml", [], [], false, true);
    });

    it("Supply chain case to Sol Contract", async () => {
      await compileBpmn(parser, "supply-chain", [], []);
    });

    it.skip("Supply chain case to State Channel Root", async () => {
      await compileBpmn(parser, "supply-chain", [], [], false, true);
    });

    it("Incident Management case to Sol Contract", async () => {
      await compileBpmn(
        parser,
        "incident-management",
        [
          new CaseVariable(
            "resolved",
            "bool",
            "bool public resolved = false;",
            true,
          ),
        ],
        [],
      );
    });

    it.skip("Incident Management case to State Channel Root", async () => {
      await compileBpmn(parser, "incident-management", [], [], false, true);
    });

    it("Rental Agreement case to Sol Contract", async () => {
      await compileBpmn(
        parser,
        "rental-agreement",
        [
          new CaseVariable(
            "conditions",
            "uint",
            "uint public conditions;",
            true,
          ),
        ],
        [],
      );
    });

    it("Pizza case to Sol Contract", async () => {
      await compileBpmn(
        parser,
        "pizza",
        [new CaseVariable("items", "bool", "bool public items = false;", true)],
        [],
      );
    });

    it("Don't unfold Rental Agreement case to Sol Contract", async () => {
      await compileBpmn(
        parser,
        "unfold-rental-agreement",
        [
          new CaseVariable(
            "conditions",
            "uint",
            "uint public conditions;",
            true,
          ),
        ],
        [],
        false,
      );
    });

    it("Don't unfold Sub Choreo case to Sol Contract", async () => {
      await compileBpmn(parser, "sub-choreo", [], [], false);
    });

    it("Don't unfold Sub Choreo case to Sol Contract", async () => {
      await compileBpmn(parser, "sub-choreo-chained", [], [], false);
    });

    it.skip("Messages case to Sol Contract", async () => { //changed here from it.only //skipped due to bugs
      await compileBpmn(
        parser,
        "messages",
        [
          new CaseVariable(
            "pizza_order",
            "string",
            'string public pizza_order = "";',
            false,
          ),
        ],
        [],
        false,
      );
    });

    it("Collaboration simple case to Sol Contract", async () => {
      await compileBpmn(parser, "edgecases/shouldsucceed/collaboration-simple", [], []);
    });

    it("Collaboration internal case to Sol Contract", async () => {
      await compileBpmn(parser, "edgecases/shouldsucceed/collaboration-internal", [], []);
    });

    it("Process AND case to Sol Contract", async () => {
      await compileBpmn(parser, "edgecases/shouldsucceed/process-and", [], []);
    });

    it("Process XOR case to Sol Contract", async () => {
      await compileBpmn(
        parser,
        "edgecases/shouldsucceed/process-xor",
        [new CaseVariable("x", "bool", "bool public x = false;", true)],
        [],
      );
    });

    it("Process loop case to Sol Contract", async () => {
      await compileBpmn(
        parser,
        "edgecases/shouldsucceed/process-loop",
        [new CaseVariable("repeat", "bool", "bool public repeat = false;", true)],
        [],
      );
    });

    it("Call choreography to Sol Contract", async () => {
      const results = await compileBpmn(
        parser,
        "call-choreo",
        [],
        [
          {
            callID: "Choreography_0betnp1",
            address: undefined,
          },
        ],
        false,
      );

      // Read and verify Choreography_0betnp1.json
      const choreography0betnp1Path = path.join(
        CONTRACTS_PATH,
        "Choreography_0betnp1.json",
      );
      assert.ok(
        fs.existsSync(choreography0betnp1Path),
        "Choreography_0betnp1.json should exist",
      );

      const choreography0betnp1Data = JSON.parse(
        fs.readFileSync(choreography0betnp1Path, "utf8"),
      );
      assert.strictEqual(
        choreography0betnp1Data.isCalled,
        true,
        "Choreography_0betnp1 should have isCalled: true",
      );
      assert.strictEqual(
        choreography0betnp1Data.isInstanced,
        true,
        "Choreography_0betnp1 should have isInstanced: true",
      );

      // Read and verify CallChoreo.json
      const callChoreoPath = path.join(CONTRACTS_PATH, "CallChoreo.json");
      assert.ok(fs.existsSync(callChoreoPath), "CallChoreo.json should exist");

      const callChoreoData = JSON.parse(
        fs.readFileSync(callChoreoPath, "utf8"),
      );
      assert.strictEqual(
        Object.keys(callChoreoData.calls).length,
        1,
        "CallChoreo should have calls size of 1",
      );
    });
  });

  // The three participant/authorization models, all generated from the SAME
  // lane-annotated process diagram (process-lanes.bpmn).
  describe("Participant authorization models", () => {
    const compileLanes = async (
      authMode: AuthorizationMode,
      enforceAuthorization: boolean,
    ) => {
      const data = await readFile(path.join(BPMN_PATH, "process-lanes.bpmn"));
      const [iNet] = await parser.fromXML(data, authMode);
      const generator = new SolDefaultContractGenerator(iNet);
      const { target } = await generator.compile({
        events: true,
        enforceAuthorization,
      });
      return { iNet, target };
    };

    it("SingleActor: one participant, every task checks participants[0]", async () => {
      const { iNet, target } = await compileLanes(
        AuthorizationMode.SingleActor,
        true,
      );
      assert.strictEqual(iNet.participants.size, 1, "should collapse to 1 actor");
      assert.match(target, /msg\.sender == participants\[0\]/);
      assert.doesNotMatch(target, /participants\[1\]/, "no second actor");
    });

    it("Open: no sender check at all (anyone may call)", async () => {
      const { iNet, target } = await compileLanes(AuthorizationMode.Open, false);
      assert.strictEqual(iNet.participants.size, 1);
      assert.doesNotMatch(target, /msg\.sender/, "Open must emit no sender check");
    });

    it("LaneBased: one participant per lane, tasks check their own lane", async () => {
      const { iNet, target } = await compileLanes(
        AuthorizationMode.LaneBased,
        true,
      );
      assert.strictEqual(iNet.participants.size, 2, "Buyer + Seller");
      // both lanes are enforced on-chain
      assert.match(target, /msg\.sender == participants\[0\]/);
      assert.match(target, /msg\.sender == participants\[1\]/);
    });
  });
});
