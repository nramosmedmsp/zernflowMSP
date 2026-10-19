import type { Json, TriggerType } from "@/lib/types/database";

/** The trigger types the flow builder owns. Growth-tab rows are channel-scoped
 *  and are never produced (or reconciled) from a node graph. */
export const BUILDER_TRIGGER_TYPES = [
  "keyword",
  "postback",
  "quick_reply",
  "welcome",
  "default",
  "comment_keyword",
  // Fase 2: eventos de gestión (lib/flow-engine/case-triggers.ts).
  "case_opened",
  "case_stage_changed",
  "case_closed",
  "client_no_reply",
] as const;

type BuilderTriggerType = (typeof BUILDER_TRIGGER_TYPES)[number];

const isBuilderTriggerType = (t: string): t is BuilderTriggerType =>
  (BUILDER_TRIGGER_TYPES as readonly string[]).includes(t);

export interface DesiredTrigger {
  flow_id: string;
  channel_id: null;
  type: TriggerType;
  config: Json;
  is_active: boolean;
  priority: number;
}

/**
 * Derive the `triggers` rows a published flow should have from its node graph.
 *
 * One node usually maps to one row. The exception is a `comment_keyword` node
 * with "also match in DMs", which emits a second row typed `keyword`: the
 * runtime matcher keys the DM path off that type, so this is what lets one flow
 * answer both a comment and a DM carrying the same keyword.
 */
export function buildDesiredTriggers(
  flowNodes: Array<Record<string, unknown>>,
  flowId: string,
): DesiredTrigger[] {
  return flowNodes
    .filter((n) => n?.type === "trigger")
    .flatMap((n) => {
      const data = (n.data ?? {}) as Record<string, any>;
      const nodeConfig = (data.config ?? {}) as Record<string, any>;
      const type = (data.triggerType ?? "keyword") as string;
      if (!isBuilderTriggerType(type)) return [];

      // The trigger panel stores keywords as data.keywords ([{ value, matchType }]);
      // template-seeded nodes store data.config.keywords ([string]). The matcher
      // accepts both shapes, so pass through whichever the node carries.
      const config: Record<string, any> = {};
      if (type === "keyword" || type === "comment_keyword") {
        config.keywords = data.keywords ?? nodeConfig.keywords ?? [];
        if (nodeConfig.matchType) config.matchType = nodeConfig.matchType;
        const postIds = data.postIds ?? nodeConfig.postIds;
        if (Array.isArray(postIds) && postIds.length > 0) config.postIds = postIds;
        const replyText = data.replyText ?? nodeConfig.replyText;
        if (typeof replyText === "string" && replyText.trim()) config.replyText = replyText;
      } else if (type === "postback" || type === "quick_reply") {
        const payload = data.payload ?? nodeConfig.payload;
        if (payload !== undefined) config.payload = payload;
      } else if (
        type === "case_opened" ||
        type === "case_stage_changed" ||
        type === "case_closed" ||
        type === "client_no_reply"
      ) {
        // El panel guarda caseTypeId, stageId, outcome, minutes, onlyUnclassified y
        // contactTypeIds; la base los lee como case_type_id, stage_id, outcome,
        // minutes, only_unclassified y contact_type_ids (CaseTriggerConfig).
        const caseTypeId = data.caseTypeId ?? nodeConfig.case_type_id;
        if (typeof caseTypeId === "string" && caseTypeId) config.case_type_id = caseTypeId;
        if (type === "case_opened") {
          if ((data.onlyUnclassified ?? nodeConfig.only_unclassified) === true) config.only_unclassified = true;
          const contactTypeIds = data.contactTypeIds ?? nodeConfig.contact_type_ids;
          if (Array.isArray(contactTypeIds)) {
            const ids = contactTypeIds.filter((v): v is string => typeof v === "string" && v.trim() !== "");
            if (ids.length > 0) config.contact_type_ids = ids;
          }
        }
        if (type === "case_stage_changed") {
          const stageId = data.stageId ?? nodeConfig.stage_id;
          if (typeof stageId === "string" && stageId) config.stage_id = stageId;
        }
        if (type === "case_closed") {
          const outcome = data.outcome ?? nodeConfig.outcome;
          if (outcome === "won" || outcome === "lost" || outcome === "resolved") config.outcome = outcome;
        }
        if (type === "client_no_reply") {
          const minutes = Number(data.minutes ?? nodeConfig.minutes);
          if (Number.isInteger(minutes) && minutes > 0) config.minutes = minutes;
        }
      }

      const row: DesiredTrigger = {
        flow_id: flowId,
        channel_id: null,
        type: type as TriggerType,
        config,
        is_active: true,
        priority: typeof nodeConfig.priority === "number" ? nodeConfig.priority : 0,
      };

      // postIds (post scoping) and replyText (the public reply on the comment)
      // are dropped from the DM row: a DM has neither a post nor a comment.
      if (type === "comment_keyword" && data.alsoMatchInDms === true && config.keywords?.length) {
        const { postIds: _postIds, replyText: _replyText, ...dmConfig } = config;
        return [row, { ...row, type: "keyword" as TriggerType, config: dmConfig }];
      }

      return [row];
    });
}
