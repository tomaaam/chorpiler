import { InteractionNet } from "./InteractionNet.js";
import type { AuthorizationMode } from "./FastXMLParser.js";

export interface INetParser {
  fromXML(
    xml: Buffer,
    authMode?: AuthorizationMode,
  ): Promise<InteractionNet[]>;
}
