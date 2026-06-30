/**
 * Renders chorpiler's intermediate InteractionNet (a Petri net) as a diagram,
 * the same formalism as the BPMN-derived nets in the literature.
 *
 *   npm run script/viz -- tests/input/bpmn/edgecases/shouldsucceed/collaboration-simple.bpmn
 *   npm run script/viz -- tests/input/bpmn/process-lanes.bpmn LaneBased
 *
 * Emits <netId>.dot and, if Graphviz `dot` is available, <netId>.svg into
 * tests/output/diagrams/.
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import path from "path";
import { AuthorizationMode, INetFastXMLParser } from "../../../src/Parser/FastXMLParser.js";
import { InteractionNet } from "../../../src/Parser/InteractionNet.js";
import { Place, PlaceType } from "../../../src/Parser/Elements/Place.js";
import { LabelType, TaskLabel } from "../../../src/Parser/Elements/Label.js";
import { OUTPUT_PATH } from "../../config.js";

const DIAGRAM_DIR = path.join(OUTPUT_PATH, "diagrams");

const esc = (s: string) => s.replace(/"/g, '\\"');
const q = (s: string) => `"${esc(s)}"`;

// Short label for a silent (gateway/event) transition.
function silentLabel(type: LabelType): string {
  switch (type) {
    case LabelType.ParallelDiverging:
      return "AND\\nsplit";
    case LabelType.ParallelConverging:
      return "AND\\njoin";
    case LabelType.DataExclusiveOutgoing:
    case LabelType.EventExclusiveOutgoing:
      return "XOR\\nsplit";
    case LabelType.DataExclusiveIncoming:
    case LabelType.EventExclusiveIncoming:
      return "XOR\\njoin";
    case LabelType.Start:
      return "start";
    case LabelType.End:
      return "end";
    case LabelType.SubChoreography:
      return "sub";
    case LabelType.CallChoreography:
      return "call";
    default:
      return "";
  }
}

function toDot(net: InteractionNet, rankdir: string = "LR"): string {
  const lines: string[] = [];
  lines.push(`digraph "${esc(net.id)}" {`);
  lines.push(`  rankdir=${rankdir};`);
  lines.push('  node [fontname="Helvetica" fontsize=12];');
  lines.push('  edge [color="#666666" arrowsize=0.7];');

  for (const [id, el] of net.elements) {
    if (el instanceof Place) {
      // places = circles; start filled, end double circle
      if (el.type === PlaceType.Start) {
        lines.push(
          `  ${q(id)} [shape=circle width=0.3 label="" style=filled fillcolor="#333333"];`,
        );
      } else if (el.type === PlaceType.End) {
        lines.push(
          `  ${q(id)} [shape=doublecircle width=0.25 label=""];`,
        );
      } else {
        lines.push(`  ${q(id)} [shape=circle width=0.22 label=""];`);
      }
    } else {
      // transition
      const label = (el as any).label;
      if (label instanceof TaskLabel || label?.type === LabelType.Task) {
        const tl = label as TaskLabel;
        const roles =
          tl.receiver && tl.receiver.length > 0
            ? `\\n${tl.sender?.name ?? tl.sender?.id} → ${tl.receiver
                .map((r) => r?.name ?? r?.id)
                .join(", ")}`
            : tl.sender
              ? `\\n[${tl.sender.name ?? tl.sender.id}]`
              : "";
        const name = tl.name ?? id;
        lines.push(
          `  ${q(id)} [shape=box style="filled,rounded" fillcolor="#fde8df" ` +
            `color="#d97757" label="${esc(name)}${roles}"];`,
        );
      } else {
        // silent transition = thin grey bar (Petri-net style)
        const lbl = silentLabel(label?.type);
        lines.push(
          `  ${q(id)} [shape=box style=filled fillcolor="#e4e4e7" ` +
            `color="#999999" fontsize=8 label="${lbl}"];`,
        );
      }
    }
  }

  // edges: every element -> each of its targets (covers place->trans and trans->place)
  for (const [id, el] of net.elements) {
    for (const target of (el as any).target ?? []) {
      lines.push(`  ${q(id)} -> ${q(target.id)};`);
    }
  }

  lines.push("}");
  return lines.join("\n");
}

async function main() {
  const [, , bpmnArg, modeArg, dirArg] = process.argv;
  if (!bpmnArg) {
    console.error(
      "usage: npm run script/viz -- <path-to.bpmn> [SingleActor|Open|LaneBased] [LR|TB]",
    );
    process.exit(1);
  }
  const authMode =
    (modeArg && (AuthorizationMode as any)[modeArg]) ??
    AuthorizationMode.SingleActor;
  const rankdir = dirArg === "TB" ? "TB" : "LR";

  fs.mkdirSync(DIAGRAM_DIR, { recursive: true });
  const parser = new INetFastXMLParser();
  const nets = await parser.fromXML(fs.readFileSync(bpmnArg), authMode);

  for (const net of nets) {
    const dot = toDot(net, rankdir);
    const dotPath = path.join(DIAGRAM_DIR, `${net.id}.dot`);
    fs.writeFileSync(dotPath, dot);

    const dotBin = spawnSync("which", ["dot"]).stdout.toString().trim();
    if (dotBin) {
      const svgPath = path.join(DIAGRAM_DIR, `${net.id}.svg`);
      const res = spawnSync("dot", ["-Tsvg", dotPath, "-o", svgPath]);
      if (res.status === 0) {
        console.log(`rendered  ${svgPath}`);
        continue;
      }
    }
    console.log(`wrote     ${dotPath}  (install graphviz to auto-render SVG)`);
  }
}

await main();
