import type { AiExecutionTarget, AiExecutionTargetKind } from "@/types/models";

export type { AiExecutionTarget, AiExecutionTargetKind };

export function executionTargetKey(target: AiExecutionTarget): string {
  return `${target.kind}:${target.id}`;
}
