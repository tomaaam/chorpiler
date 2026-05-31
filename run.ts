import * as fs from "fs";
import { INetFastXMLParser } from "./src/Parser/FastXMLParser.js";
import SolDefaultContractGenerator from "./src/Generator/target/Sol/DefaultGenerator.js";

const parser = new INetFastXMLParser();
const xml = fs.readFileSync("tests/input/bpmn/edgecases/shouldsucceed/test-process.bpmn");

parser.fromXML(xml).then(async (iNets) => {
  for (const iNet of iNets) {
    const generator = new SolDefaultContractGenerator(iNet);
    const result = await generator.compile({ unfoldSubNets: true });
    console.log(result.target);
  }
}).catch(console.error);