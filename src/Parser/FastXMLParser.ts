import { XMLParser } from "fast-xml-parser";
import { Call, CallType } from "../Parser/Elements/Call.js";
import { Element } from "../Parser/Elements/Element.js";
import { Guard } from "../Parser/Elements/Guard.js";
import {
  CallLabel,
  Label,
  LabelType,
  TaskLabel,
  TaskType,
} from "../Parser/Elements/Label.js";
import { Participant } from "../Parser/Elements/Participant.js";
import { Place, PlaceType } from "../Parser/Elements/Place.js";
import { Transition } from "../Parser/Elements/Transition.js";
import { deleteFromArray } from "../util/helpers.js";
import { InteractionNet } from "./InteractionNet.js";
import { INetParser } from "./Parser.js";
import { Message } from "./Elements/Message.js";

const DEFAULT_PARTICIPANT_ID = "__default_participant__"; //dummy participant for diagrams with no real participants

enum Elements {
  rootElements = "definitions",
  choreographies = "choreography",
  processes = "process", //Phase 1
  collaborations = "collaboration", //Phase 2
  messages = "message",
  subChoreographies = "subChoreography",
  callChoreographies = "callChoreography",
  participants = "participant",
  tasks = "choreographyTask",
  processTasks = "task", //standard BPMN Task
  flows = "sequenceFlow",
  messageFlow = "messageFlow",
  participantsRef = "participantRef",
  messageFlowRef = "messageFlowRef",
  participantsMapping = "participantAssociation",
  startEvent = "startEvent",
  endEvent = "endEvent",
  exclusiveGateway = "exclusiveGateway",
  conditionExpression = "conditionExpression",
  parallelGateway = "parallelGateway",
  eventGateway = "eventBasedGateway",
  outs = "outgoing",
  ins = "incoming",
  laneSet = "laneSet",
  lane = "lane",
  flowNodeRef = "flowNodeRef",
}
enum Properties {
  id = "@_id",
  source = "@_sourceRef",
  target = "@_targetRef",
  name = "@_name",
  default = "@_default",
  language = "@_language",
  initiator = "@_initiatingParticipantRef",
  calledChor = "@_calledChoreographyRef",
  innerPar = "@_innerParticipantRef",
  outerPar = "@_outerParticipantRef",
  message = "@_messageRef",
  processRef = "@_processRef",
}

type MessageFlowEntry = { //for every task that participates in a message flow
  partnerTaskId: string,
  senderParticipant: Participant,
  receiverParticipant: Participant,
  isSender: boolean; //if true, task becomes transition; if false, task is skipped
};

/**
 * Selects how participants/authorization are derived for process diagrams.
 * - SingleActor: one dummy participant; every task carries an `msg.sender` check against it.
 * - Open: one dummy participant, but NO `msg.sender` check (any caller may execute any task).
 * - LaneBased: each lane becomes a participant; tasks are authorized against their lane.
 */
export enum AuthorizationMode {
  SingleActor = "SingleActor",
  Open = "Open",
  LaneBased = "LaneBased",
}

export class INetFastXMLParser implements INetParser {
  parser: XMLParser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true, //drop bpmn2 prefix to support any BPMN exporterD
    isArray: (_, __, ___, isAttribute) => {
      return !isAttribute;
    },
  });

  private static INetTranslator = class {
    iNet = new InteractionNet();
    flows = new Map<string, { flow: any; place: Place | null }>(); //register every flow ID upfront
    messageFlows = new Map<string, { flow: any; message: Message | null }>(); //same for messageFlows
    callList = new Map<string, string[]>();
    messages = new Map<string, Message>();
    authMode: AuthorizationMode = AuthorizationMode.SingleActor;
    taskLane = new Map<string, string>(); // taskId -> lane participant modelID (LaneBased only)

    translate(choreography: any): InteractionNet {
      // need to parse participants first, so we can reference them
      this.parseParticipants(choreography[Elements.participants]);
      return this.translateChoreography(choreography);
    }

    translateChoreography(choreography: any): InteractionNet {
      this.iNet.id = choreography[Properties.id];
      this.translateElements(choreography);
      return this.iNet;
    }

    private parseParticipants(participants: any) {
      if (!participants) return;
      for (const par of participants) {
        const newPar = new Participant(
          par[Properties.id],
          par[Properties.name],
        );
        this.iNet.participants.set(par[Properties.id], newPar);
      }
    }

    private translateElements(choreography: any, isProcess = false) {
      this
        // need to parse flows first, so they're accessible
        .parseFlows(choreography[Elements.flows])
        .parseMessageFlows(choreography[Elements.messageFlow])
        .translateStartEvent(choreography[Elements.startEvent])
        .translateEndEvent(choreography[Elements.endEvent])
        ;
        if (isProcess) {
          this.translateProcessTasks(choreography[Elements.processTasks]);
        } else {
          this.translateTasks(choreography[Elements.tasks]);
        }
        this
        .translateSubChoreography(choreography[Elements.subChoreographies])
        .translateCallChoreography(choreography[Elements.callChoreographies])
        // translate events before gateways
        .translateExclusiveGateways(choreography[Elements.exclusiveGateway])
        .translateParallelGateways(choreography[Elements.parallelGateway])
        .translateEventGateways(choreography[Elements.eventGateway])
        // connect flows last, and report error when a flow leads to an unknown transition, which means
        // we were not able to translate all elements before
        .checkFlows();

      return this.iNet;
    }

    private translateCallChoreography(callChoreographies: any) {
      if (!callChoreographies) return this;
      for (const callChoreography of callChoreographies) {
        const callNetID = callChoreography[Properties.calledChor];

        // translate sub choreography task
        const subTransition = this.addTransition(
          new Transition(
            callNetID,
            new CallLabel(`Call ${callNetID}`, callNetID),
          ),
        );
        const callingId = this.iNet.id; // Current choreography ID
        const calls = this.callList.get(callingId);
        if (calls == undefined)
          throw new Error(
            `Calling choreography (${callingId}) not found in call graph`,
          );
        if (!calls.includes(callNetID))
          throw new Error(
            `Call to choreography (${callNetID}) not found in call list of calling choreography (${callingId})`,
          );
        // extract participant participantsMapping
        const participantsMapping = new Map<string, string>();
        const mappings = callChoreography[Elements.participantsMapping];
        if (!mappings)
          throw new Error(
            `Call Choreography (${callNetID}) without participant associations`,
          );
        for (const map of mappings) {
          participantsMapping.set(
            map[Properties.outerPar],
            map[Properties.innerPar],
          );
        }
        subTransition.calls = [
          new Call(CallType.CallChoreography, callNetID, participantsMapping),
        ];
        this.translateIncomingFlows(
          subTransition,
          callChoreography[Elements.ins],
        );
        this.translateOutgoingFlows(
          subTransition,
          callChoreography[Elements.outs],
        );
      }
      return this;
    }

    // check if there are sub choreographies, if:
    // recursively translate them
    private translateSubChoreography(subChoreographies: any) {
      if (!subChoreographies) return this;
      for (const subChoreography of subChoreographies) {
        const { initiator, respondents } =
          this.parseInitiatorRespondents(subChoreography);
        const subNetID = subChoreography[Properties.id];

        // translate sub choreography task
        const subTransition = this.addTransition(
          new Transition(subNetID, new Label(LabelType.SubChoreography)),
        );
        subTransition.calls = [
          new Call(CallType.SubChoreography, subNetID, null),
        ];
        this.translateIncomingFlows(
          subTransition,
          subChoreography[Elements.ins],
        );
        this.translateOutgoingFlows(
          subTransition,
          subChoreography[Elements.outs],
        );

        const translator = new INetFastXMLParser.INetTranslator();
        // share the parent's messages and message flows so references inside
        // the sub-choreography resolve correctly
        translator.messages = this.messages;
        translator.messageFlows = this.messageFlows;
        // set subNet participants
        const subNet = translator.iNet;
        subNet.participants.set(initiator.id, initiator);
        for (const respondent of respondents)
          subNet.participants.set(respondent.id, respondent);
        // translate sub choreography
        this.iNet.subNets.set(
          subNetID,
          translator.translateChoreography(subChoreography),
        );
      }
      return this;
    }

    parseFlows(flows: any) {
      if (flows == null) throw new Error(`No flows in the model`);
      for (const flow of flows) {
        this.flows.set(flow[Properties.id], { flow: flow, place: null });
      }
      return this;
    }

    parseMessageFlows(flows: any): this {
      if (flows == null) return this;
      for (const flow of flows) {
        this.messageFlows.set(flow[Properties.id], {
          flow: flow,
          message: null,
        });
      }
      return this;
    }

    private parseInitiatorRespondents(task: any): {
      initiator: Participant;
      respondents: Participant[];
    } {
      const initiator = this.iNet.participants.get(task[Properties.initiator]);
      if (!initiator)
        throw new Error(
          `Initiator of Element not found ${task[Properties.initiator]}`,
        );
      const respondents = new Array<Participant>();
      for (const id of task[Elements.participantsRef]) {
        if (id === initiator.id) continue;
        respondents.push(this.iNet.participants.get(id)!);
      }
      return { initiator, respondents };
    }

    private translateStartEvent(starts: any): this {
      if (!starts || starts.length !== 1)
        throw new Error("Other than exactly one start event");

      const start = starts[0];
      const startEvent = new Transition(
        start[Properties.id],
        new Label(LabelType.Start),
      );
      const startPlace = new Place(
        "place_" + start[Properties.id],
        PlaceType.Start,
      );
      this.linkSourceToTarget(startPlace, startEvent);
      this.addTransition(startEvent);
      this.addPlace(startPlace); // We add it directly, as nothing should be linked to it except the start transtition
      this.iNet.initial = startPlace;
      this.translateOutgoingFlows(startEvent, start[Elements.outs]);
      return this;
    }

    private translateEndEvent(ends: any): this {
      if (!ends || ends.length !== 1)
        throw new Error("Other than exactly one end event");

      const end = ends[0];
      const endEvent = new Transition(
        end[Properties.id],
        new Label(LabelType.End),
      );
      const endPlace = new Place("place_" + end[Properties.id], PlaceType.End);
      endPlace.type = PlaceType.End;
      this.linkSourceToTarget(endEvent, endPlace);
      this.addTransition(endEvent);
      this.addPlace(endPlace); // We add it directly, as nothing should be linked to it except the end transtition
      this.iNet.end = endPlace;
      this.translateIncomingFlows(endEvent, end[Elements.ins]);
      return this;
    }

    private translateTasks(tasks: any): this {
      if (tasks == null) return this;

      for (const task of tasks) {
        const { initiator, respondents } = this.parseInitiatorRespondents(task);
        const message = this.parseMessage(task);
        const transition = this.addTransition(
          new Transition(
            task[Properties.id],
            new TaskLabel(
              initiator!,
              respondents!,
              task[Properties.name],
              task[Properties.id],
              TaskType.Task,
              message,
            ),
          ),
        );
        this.translateIncomingFlows(transition, task[Elements.ins]);
        this.translateOutgoingFlows(transition, task[Elements.outs]);
      }
      return this;
    }

    /**
     * Resolves a task's messageFlowRef through the message flow registry to a Message object.
     * Returns undefined if the task has no message flow or the message has no label.
     */
    private parseMessage(task: any): Message | undefined {
      const messageID = task[Elements.messageFlowRef];
      if (!messageID || messageID.length == 0) return undefined;
      if (messageID.length > 1)
        throw new Error(
          `Task (${task[Properties.id]}) has multiple messages (only one allowed)`,
        );
      const messageFlow = this.messageFlows.get(messageID[0]);
      if (messageFlow == undefined) {
        throw new Error(
          `Message is referencing (id: ${messageID}) to unknown message flow`,
        );
      }

      const messageRef = messageFlow.flow[Properties.message];
      const message = this.messages.get(messageRef);
      if (message == undefined) {
        throw new Error(`Message ref (id: ${message}) to unknown message`);
      }
      if (message.label == undefined || message.label.length == 0) {
        return undefined;
      }
      this.iNet.namedMessages.set(message.modelID, message);
      messageFlow.message = message;
      return message;
    }

    /** PHASE 1
      * Counterpart to translateChoreography — sets up participants from lanes or a dummy, 
      * then delegates to the shared translation pipeline.
      */
    translateProcess(process: any): InteractionNet {
      this.iNet.id = process[Properties.id];

      // LaneBased: derive one participant per lane. Falls back to a single dummy participant when the diagram has no lanes. 
      const usingLanes =
        this.authMode === AuthorizationMode.LaneBased && this.parseLanes(process);

      if (!usingLanes) {
        const defaultParticipant = new Participant(
          DEFAULT_PARTICIPANT_ID,
          process[Properties.name] ?? "Process",
        );
        this.iNet.participants.set(DEFAULT_PARTICIPANT_ID, defaultParticipant);
      }
      this.translateElements(process, true);
      return this.iNet;
    }

    /**
     * Parses BPMN lanes into participants and records which lane each task
     * belongs to (via flowNodeRef). Returns true if at least one lane mapping
     * was found.
     */
    private parseLanes(process: any): boolean {
      const laneSets = process[Elements.laneSet];
      if (!laneSets) return false;

      let found = false;
      for (const laneSet of laneSets) {
        for (const lane of laneSet[Elements.lane] ?? []) {
          const laneId = lane[Properties.id];
          this.iNet.participants.set(
            laneId,
            new Participant(laneId, lane[Properties.name] ?? laneId),
          );
          for (const nodeRef of lane[Elements.flowNodeRef] ?? []) {
            // flowNodeRef is text-only; fast-xml-parser yields a string,
            // but guard for the object form just in case.
            const ref = typeof nodeRef === "string" ? nodeRef : nodeRef["#text"];
            if (ref) {
              this.taskLane.set(ref, laneId);
              found = true;
            }
          }
        }
      }
      return found;
    }
    
    /**
     * Translates standard BPMN tasks for process diagrams. Since process tasks carry no
     * initiator or participantRef in the XML, these are injected synthetically so that
     * the shared parseInitiatorRespondents logic can be reused.
     */
    private translateProcessTasks(tasks: any): this {
      if (tasks == null) return this;

      for (const task of tasks) {
        // LaneBased assigns the task's lane participant; otherwise the single
        // dummy participant is used.
        const initiatorId =
          this.taskLane.get(task[Properties.id]) ?? DEFAULT_PARTICIPANT_ID;
        if (!task[Elements.participantsRef]) {
          task[Elements.participantsRef] = [initiatorId];
        }
        if (!task[Properties.initiator]) {
          task[Properties.initiator] = initiatorId;
        }
        const { initiator, respondents } = this.parseInitiatorRespondents(task);
        const transition = this.addTransition(
          new Transition(
            task[Properties.id],
            new TaskLabel(
              initiator!, 
              respondents!, 
              task[Properties.name],
              task[Properties.id],
              TaskType.Task,
              undefined,
            ),
          ),
        );
        this.translateIncomingFlows(transition, task[Elements.ins]);
        this.translateOutgoingFlows(transition, task[Elements.outs]);
      }
      return this;
    }

    /** PHASE 2
    * Translates a BPMN collaboration into one InteractionNet. An internal task is
    * owned by its pool participant; a send task and its matching receive task are
    * merged into a single labelled transition. Pools' separate start/end events are
    * joined by a global AND-split/join (see translateCollaborationStartEnd).
    */
    translateCollaboration(
      collaboration: any, 
      processes: any[], 
      participantByProcess: Map<string, Participant>, 
      messageFlowIndex: Map<string, MessageFlowEntry>,
    ): InteractionNet {
      this.iNet.id = collaboration[Properties.id];

      for (const [, participant] of participantByProcess) {
        this.iNet.participants.set(participant.id, participant);
      }

      for (const process of processes) {
        this.parseFlows(process[Elements.flows]);
      }

      if (processes.length === 1) {
        this.translateStartEvent(processes[0][Elements.startEvent]);
        this.translateEndEvent(processes[0][Elements.endEvent]);
      } else {
        this.translateCollaborationStartEnd(processes);
      }

      const receiverTaskIds = new Set<string>(); // receive tasks are absorbed into their sender, so skip them below
      for (const [taskId, entry] of messageFlowIndex) {
        if (!entry.isSender) receiverTaskIds.add(taskId);
      }

      for (const process of processes) {
        const processId = process[Properties.id];
        const poolParticipant = participantByProcess.get(processId)!;

        for (const task of process[Elements.processTasks] ?? []) {
          const taskId = task[Properties.id];
          if (receiverTaskIds.has(taskId)) continue;

          const entry = messageFlowIndex.get(taskId);
          let transition: Transition;

          if (entry) { // message sender: merge the partner receive task into one transition (sender = initiator, receiver = respondent)
            transition = this.addTransition(
              new Transition(
                taskId, 
                new TaskLabel(
                  entry.senderParticipant,
                  [entry.receiverParticipant],
                  task[Properties.name],
                  taskId,
                  TaskType.Task,
                  undefined,
                ),
              ),
            );
            this.translateIncomingFlows(transition, task[Elements.ins]);
            this.translateOutgoingFlows(transition, task[Elements.outs]);
            const receiverTask = this.findCollaborationTask(processes, entry.partnerTaskId);
            if (receiverTask) {
              this.translateIncomingFlows(transition, receiverTask[Elements.ins]);
              this.translateOutgoingFlows(transition, receiverTask[Elements.outs]);
            }
          } else {
            transition = this.addTransition(
              new Transition(
                taskId,
                new TaskLabel(
                  poolParticipant, 
                  [],
                  task[Properties.name],
                  taskId,
                  TaskType.Task,
                  undefined,
                ),
              ),
            );
            this.translateIncomingFlows(transition, task[Elements.ins]);
            this.translateOutgoingFlows(transition, task[Elements.outs]);
          }
        }
      }
      for (const process of processes) {
        this.translateExclusiveGateways(process[Elements.exclusiveGateway]);
        this.translateParallelGateways(process[Elements.parallelGateway]);
        this.translateEventGateways(process[Elements.eventGateway]);
      }

      this.checkFlows();
      return this.iNet;
    }

    findCollaborationTask(processes: any[], taskId: string): any | undefined { // fold the receive task's flows in, so the transition fires only when both pools are ready
      for (const process of processes) {
        for (const task of process[Elements.processTasks] ?? []) {
          if (task[Properties.id] === taskId) return task;
        }
      }
      return undefined;
    }

    /**
      * Models parallel pool execution by wrapping all pool start/end events with a
      * single global AND-split (on start) and AND-join (on end), so all pools must
      * complete for the collaboration to finish.
    */

    translateCollaborationStartEnd(processes: any[]): void {
      const globalStart = new Place("collab_start", PlaceType.Start);
      this.addPlace(globalStart);
      this.iNet.initial = globalStart;

      const andSplit = new Transition(
        "collab_and_split",
        new Label(LabelType.ParallelDiverging),
      );
      this.addTransition(andSplit);
      this.linkSourceToTarget(globalStart, andSplit);

      const globalEnd = new Place("collab_end", PlaceType.End);
      this.addPlace(globalEnd);
      this.iNet.end = globalEnd;

      const andJoin = new Transition(
        "collab_and_join",
        new Label(LabelType.ParallelConverging),
      );
      this.addTransition(andJoin);
      this.linkSourceToTarget(andJoin, globalEnd);

      for (const process of processes) {
        const starts = process[Elements.startEvent];
        if (!starts || starts.length !== 1) {
          throw new Error("Each process in a collaboration must have exactly one start event");
        }
        const start = starts[0];
        const startTransition = new Transition(start[Properties.id], new Label(LabelType.Start));
        const startPlace = new Place("place_" + start[Properties.id]);
        this.linkSourceToTarget(andSplit, startPlace);
        this.linkSourceToTarget(startPlace, startTransition);
        this.addTransition(startTransition);
        this.addPlace(startPlace);
        this.translateOutgoingFlows(startTransition, start[Elements.outs]);

        const ends = process[Elements.endEvent];
        if (!ends || ends.length !== 1) {
          throw new Error("Each process in a collaboration must have exactly one end event");
        }
        const end = ends[0];
        const endTransition = new Transition(end[Properties.id], new Label(LabelType.End));
        const endPlace = new Place("place_" + end[Properties.id]);
        this.linkSourceToTarget(endTransition, endPlace);
        this.linkSourceToTarget(endPlace, andJoin);
        this.addTransition(endTransition);
        this.addPlace(endPlace);
        this.translateIncomingFlows(endTransition, end[Elements.ins]);
      }
    }

    /**
     * Event-based gateways: merges all incoming flows into one place and re-wires each outgoing
     * event directly to it. Must run after tasks, since it re-uses places they already created.
     */
    private translateEventGateways(gateways: any) {
      if (gateways == null) return this;

      for (const gateway of gateways) {
        const gatewayID = gateway[Properties.id];

        const inIDs = gateway[Elements.ins];
        const gatewayFlowID = inIDs[0]; // use this flow as gateway place
        const gatewayPlace = this.setFlowPlace(
          gatewayFlowID,
          new Place(gatewayID + "_" + inIDs.join("_")),
        ); // flow merge
        for (const inID of inIDs) {
          // assign all incoming flows to gateway place
          this.setFlowPlace(inID, gatewayPlace);
        }

        const outIDs = gateway[Elements.outs];
        if (outIDs.length < 2) {
          throw new Error(
            `Event Gateway (${gatewayID}) requires at least two outgoing flows`,
          );
        }
        for (const outID of outIDs) {
          const outPlace = this.getPlace(outID);
          if (!outPlace || outPlace.target.length !== 1)
            throw new Error(
              `Event-based gateway outgoing flow (${outID}) does not lead to a singular event`,
            );
          const outTransition = outPlace!.target[0];
          if (!this.isEvent(outTransition))
            throw new Error(
              `Event-based gateway outgoing transition (${outTransition.id}) is not an event`,
            );
          if (outTransition.source.length !== 1)
            throw new Error(
              `Target elements (${outTransition.id}) of an Event Gateway (${gatewayID}) MUST NOT have any additional incoming Sequence Flows.`,
            );
          // delete the current outgoing flows, as events now connect to the gatewayPlace
          this.deleteElement(outID);
          this.linkSourceToTarget(gatewayPlace, outTransition); // re-wire event with gateway place
        }
      }
      return this;
    }

    // In the event-based gateway context, each outgoing branch is a choreography task acting as a receive event.
    isEvent(el: Transition) {
      return el instanceof Transition && el.label.type === LabelType.Task;
    }

    /**
     * XOR gateways: converging side merges incoming flows into one place; diverging side creates
     * one transition per outgoing flow with a guard condition attached.
     */
    private translateExclusiveGateways(gateways: any): this {
      if (gateways == null) return this;

      for (const gateway of gateways) {
        const gatewayID = gateway[Properties.id];
        const outs = gateway[Elements.outs];
        const ins = gateway[Elements.ins];

        if (outs.length === 1 && outs.length < ins.length) {
          // converging
          const convergingPlace = this.setFlowPlace(
            outs[0],
            new Place(outs[0]),
          );
          // build transition and link place for each incoming flow
          for (const flowID of ins) {
            const id = `${gatewayID}_${flowID}`;
            const transition = new Transition(
              id,
              new Label(LabelType.DataExclusiveIncoming),
            );
            this.linkSourceToTarget(
              this.setFlowPlace(flowID, new Place(flowID)),
              transition,
            );
            this.linkSourceToTarget(transition, convergingPlace);
            this.addTransition(transition);
          }
        } else if (ins.length === 1 && ins.length < outs.length) {
          // diverging
          const divergingPlace = this.setFlowPlace(ins[0], new Place(ins[0]));
          if (!gateway[Properties.default])
            throw new Error("XOR without an outgoing default flow");

          // build transition for each outcoming flow
          for (const flowID of outs) {
            const id = `${gatewayID}_${flowID}`;
            const transition = new Transition(
              id,
              new Label(LabelType.DataExclusiveOutgoing),
            );
            // mark guards
            this.translateGuards(
              transition,
              flowID,
              gateway[Properties.default] === flowID,
            );
            this.linkSourceToTarget(
              transition,
              this.setFlowPlace(flowID, new Place(flowID)),
            );
            this.linkSourceToTarget(divergingPlace, transition);
            this.addTransition(transition);
          }
        } else {
          throw new Error(
            "Neither converging nor diverging Exclusive (Data or Event) Gateway",
          );
        }
      }
      return this;
    }

    private translateGuards(
      transition: Transition,
      flowID: string,
      defaultFlow: boolean,
    ) {
      const flow = this.getFlow(flowID)!.flow;
      const guard = new Guard(flow[Properties.name] ?? "no name", defaultFlow);

      if (!defaultFlow) {
        if (
          !flow[Elements.conditionExpression] ||
          flow[Elements.conditionExpression].length !== 1
        ) {
          throw new Error(
            `XOR outgoing flow (${flowID}) without or malformed condition script expression`,
          );
        }
        const condition = flow[Elements.conditionExpression][0];
        const lang = condition[Properties.language];
        const expression = condition["#text"];
        if (!expression || !lang)
          throw new Error(
            `XOR outgoing flow (${flowID}) without proper (language and expression) script condition expression`,
          );

        guard.conditions.set(flowID, expression);
      }

      transition.label.guard = guard;
    }

    /**
     * AND gateways: converging side adds a transition that consumes one token from each incoming
     * flow; diverging side adds a transition that produces one token on each outgoing flow.
     */
    private translateParallelGateways(gateways: any): this {
      if (gateways == null) return this;

      for (const gateway of gateways) {
        const gatewayID = gateway[Properties.id];
        const outs = gateway[Elements.outs];
        const ins = gateway[Elements.ins];

        if (outs.length === 1 && outs.length < ins.length) {
          // converging
          const gatewayTransition = this.addTransition(
            new Transition(gatewayID, new Label(LabelType.ParallelConverging)),
          );
          this.linkSourceToTarget(
            gatewayTransition,
            this.setFlowPlace(outs[0], new Place(outs[0])),
          );
          for (const inID of ins)
            this.linkSourceToTarget(
              this.setFlowPlace(inID, new Place(inID)),
              gatewayTransition,
            );
        } else if (ins.length === 1 && ins.length < outs.length) {
          // diverging
          const gatewayTransition = this.addTransition(
            new Transition(gatewayID, new Label(LabelType.ParallelDiverging)),
          );
          this.linkSourceToTarget(
            this.setFlowPlace(ins[0], new Place(ins[0])),
            gatewayTransition,
          );
          for (const outID of outs)
            this.linkSourceToTarget(
              gatewayTransition,
              this.setFlowPlace(outID, new Place(outID)),
            );
        } else {
          throw new Error("Neither converging nor diverging AND Gateway");
        }
      }
      return this;
    }

    // Validates that every registered flow was claimed by a transition. An unconnected flow
    // usually means the diagram contains an unsupported element type (e.g. intermediate events).
    private checkFlows() {
      if (this.flows.size === 0) throw new Error(`No flows to connect`);

      for (const flow of this.flows.values()) {
        if (!flow.place)
          throw new Error(`Unset Flow ${flow.flow[Properties.id]} found`);

        if (flow.place.type !== PlaceType.End && flow.place.target.length === 0)
          throw new Error(
            `Unconncted Flow ${flow.flow[Properties.id]} found leading to
            ${flow.flow[Properties.target]} (Target Unsupported Element?)`,
          );
      }
    }

    private linkSourceToTarget(source: Element, target: Element) {
      if (!target.source.includes(source)) target.source.push(source);
      if (!source.target.includes(target)) source.target.push(target);
    }

    private unlinkElement(id: string) {
      const el = this.iNet.elements.get(id);
      if (el) {
        for (const source of el.source) deleteFromArray(source.target, el);
        for (const target of el.target) deleteFromArray(target.source, el);
      }
    }

    private deleteElement(id: string) {
      this.unlinkElement(id);
      this.iNet.elements.delete(id);
    }

    private getPlace(id: string) {
      return this.flows.get(id)?.place;
    }

    private getFlow(id: string) {
      return this.flows.get(id);
    }

    // Assigns a place to a flow. If the flow already has a place (claimed by another element),
    // the two places are merged rather than replaced, preserving all existing arc connections.
    private setFlowPlace(id: string, place: Place): Place {
      const existing = this.getFlow(id);
      if (!existing) throw Error(`Flow not found: ${id}`);
      if (existing.place) {
        this.mergePlaces(place, existing.place);
      } else {
        existing.place = this.addPlace(place);
      }
      this.flows.set(id, existing);
      return existing.place;
    }

    private addPlace(el: Place): Place {
      return this.addElement(el) as Place;
    }

    private mergePlaces(add: Place, existing: Place): Place {
      // Copy all sources of del into keep
      for (const source of add.source)
        if (!existing.source.includes(source)) existing.source.push(source);
      for (const target of add.target)
        if (!existing.target.includes(target)) existing.target.push(target);
      return existing;
    }

    private addTransition(el: Transition): Transition {
      return this.addElement(el) as Transition;
    }

    private addElement(el: Element): Element {
      // Be aware of already connected places
      if (!this.iNet.elements.has(el.id)) this.iNet.elements.set(el.id, el);

      return this.iNet.elements.get(el.id)!;
    }

    translateOutgoingFlows(transition: Transition, outIDs: any[]) {
      for (const id of outIDs) {
        this.linkSourceToTarget(
          transition,
          this.setFlowPlace(id, new Place(id)),
        );
      }
    }

    // Multiple incoming flows share a single place so that a token on any one of them enables the transition (OR-join).
    translateIncomingFlows(transition: Transition, inIDs: any[]) {
      const place = new Place(inIDs.join("_")); // flow merge
      for (const id of inIDs) {
        this.linkSourceToTarget(this.setFlowPlace(id, place), transition);
      }
    }

  };

  fromXML(
    xml: Buffer,
    authMode: AuthorizationMode = AuthorizationMode.SingleActor,
  ): Promise<InteractionNet[]> {
    return new Promise<InteractionNet[]>((resolve, reject) => {
      const parsed = this.parser.parse(xml.toString());
      if (!(Elements.rootElements in parsed))
        return reject(new Error("No root elements found, malformed XML?"));
      const rootElements = parsed[Elements.rootElements][0];
      
      const hasChoreographies = 
        Elements.choreographies in rootElements && 
        rootElements[Elements.choreographies].length > 0;

      const hasProcesses = 
        Elements.processes in rootElements && 
        rootElements[Elements.processes].length > 0;

      const hasCollaborations = 
        Elements.collaborations in rootElements &&
        rootElements[Elements.collaborations].length > 0;
      
      // Only process standalone process diagrams; collaboration-embedded processes are handled in Phase 2
      if (!hasChoreographies && !hasProcesses && !hasCollaborations) return reject(new Error("No choreography, process or collaboration found"));

      
      const messages = this.translateMessages(rootElements[Elements.messages]);
      const iNets = new Map<string, InteractionNet>();

      if (hasChoreographies) {
        const callList = this.extractCallGraph(rootElements[Elements.choreographies]);
        for (const choreography of rootElements[Elements.choreographies]) {
          const iNetTranslator = new INetFastXMLParser.INetTranslator();
          iNetTranslator.callList = callList;
          iNetTranslator.messages = messages;
          try {
            const iNet = iNetTranslator.translate(choreography);
            iNets.set(iNet.id, iNet);
          } catch (error) {
            return reject(error);
          }
        }
        // Wire up cross-net call references after all nets are built,
        // since a caller may reference a net that was parsed later in the file.
        for (const iNet of iNets.values()) {
          const calls = callList.get(iNet.id);
          if (calls != undefined) {
            for (const callID of calls) {
              const calledNet = iNets.get(callID)!;
              iNet.callList.set(callID, calledNet);
              calledNet.isCalled = true;
            }
          }
        }
      }  
      if (hasProcesses && !hasChoreographies && !hasCollaborations) {
        for (const process of rootElements[Elements.processes]) {
          const t = new INetFastXMLParser.INetTranslator();
          t.messages = messages;
          t.authMode = authMode;
          try {
            const iNet = t.translateProcess(process);
            iNets.set(iNet.id, iNet);
          } catch (e) {
            return reject(e);
          }
        }  
      }

      if (hasCollaborations) {
        const collaboration = rootElements[Elements.collaborations][0];
        const processes = rootElements[Elements.processes] ?? [];
        const { participantByprocess, messageFlowIndex } =
          this.buildCollaborationIndex(collaboration, processes);
        const t = new INetFastXMLParser.INetTranslator();
        t.messages = messages;
        try {
          const iNet = t.translateCollaboration(
            collaboration, 
            processes,
            participantByprocess,
            messageFlowIndex,
          );
          iNets.set(iNet.id, iNet)
        } catch (e) {
          return reject(e);
        }
      }

      return resolve([...iNets.values()]);
    });
  }

  translateMessages(messages: any) {
    const parsed = new Map<string, Message>();
    if (!messages) return parsed;
    for (const message of messages) {
      parsed.set(
        message[Properties.id],
        new Message(message[Properties.id], message[Properties.name]),
      );
    }
    return parsed;
  }

  // Scans all choreographies for callChoreography elements and builds a map of caller → [callee IDs].
  // Must run before translation so the translator can validate call targets exist.
  extractCallGraph(choreographies: any) {
    const callList = new Map<string, string[]>();

    for (const choreography of choreographies) {
      const callingId = choreography[Properties.id];
      if (!choreography[Elements.callChoreographies]) continue;

      const calls: string[] = [];
      for (const callChoreography of choreography[
        Elements.callChoreographies
      ]) {
        const calledId = callChoreography[Properties.calledChor];
        calls.push(calledId);
      }

      if (calls.length > 0) {
        callList.set(callingId, calls);
      }
    }
    return callList;
  }

  /**
   * Builds two lookup structures needed by translateCollaboration:
   * participantByProcess maps each process ID to its pool participant, and
   * messageFlowIndex maps each task involved in a message flow to a MessageFlowEntry
   * so translateCollaboration can identify senders, receivers, and their partners.
   */
  buildCollaborationIndex(collaboration: any, processes: any[]) {
    const participantByprocess = new Map<string, Participant>();
    for (const par of collaboration[Elements.participants] ?? []) {
      const ref = par[Properties.processRef];
      if (!ref) continue;
      participantByprocess.set(ref, new Participant(par[Properties.id], par[Properties.name]));
    }

    const taskToProcess = new Map<string, string>();
    for (const process of processes) {
      for (const task of process[Elements.processTasks] ?? []) {
        taskToProcess.set(task[Properties.id], process[Properties.id]);
      }
    }

    const messageFlowIndex = new Map<string, MessageFlowEntry>();
    for (const flow of collaboration[Elements.messageFlow] ?? []) {
      const sendTaskId = flow[Properties.source];
      const recvTaskId = flow[Properties.target];

      const senderProcessId = taskToProcess.get(sendTaskId);
      const receiverProcessId = taskToProcess.get(recvTaskId);

      if (!senderProcessId)
        throw new Error(`messageFlow source task (${sendTaskId}) not found in any process`);
      if (!receiverProcessId)
        throw new Error(`messageFlow target task (${recvTaskId}) not found in any process`);

      const senderParticipant = participantByprocess.get(senderProcessId);
      const receiverParticipant = participantByprocess.get(receiverProcessId);

      if (!senderParticipant)
        throw new Error(`process (${senderProcessId}) has no pool participant with processRef`);
      if (!receiverParticipant)
        throw new Error(`process (${receiverProcessId}) has no pool participant with processRef`);
      
      messageFlowIndex.set(sendTaskId, { partnerTaskId: recvTaskId, senderParticipant, receiverParticipant, isSender : true});
      messageFlowIndex.set(recvTaskId, {partnerTaskId: sendTaskId, senderParticipant, receiverParticipant, isSender: false});
    }
    return { participantByprocess, messageFlowIndex }
  }

}
