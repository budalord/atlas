import { promises as fs } from "node:fs";
import path from "node:path";
import type { IntakeStage, IntakeStatus } from "@atlas/shared";
import { dataPath } from "./fileReader";

const FILES = {
  intake: "INTAKE.md",
  archived: "INTAKE.archive.md",
  discovery: "DISCOVERY.md",
  interview: "INTERVIEW.md",
  status: "STATUS.md"
} as const;

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Determine which Intake stage a product is currently in based purely on
 * file presence and simple text matching — no markdown parsing.
 */
export async function detectIntakeStage(productId: string): Promise<IntakeStatus> {
  const productDir = dataPath("products", productId);
  const archived = await exists(path.join(productDir, FILES.archived));
  const intake = await exists(path.join(productDir, FILES.intake));
  const discovery = await exists(path.join(productDir, FILES.discovery));
  const interview = await exists(path.join(productDir, FILES.interview));
  const statusFile = await exists(path.join(productDir, FILES.status));

  let interviewAnswered = false;
  if (interview) {
    const text = (await readIfExists(path.join(productDir, FILES.interview))) ?? "";
    interviewAnswered = !text.includes("[ ] 待回答");
  }

  let stage: IntakeStage = "stage1";

  if (archived) {
    stage = "done";
  } else if (statusFile) {
    const text = (await readIfExists(path.join(productDir, FILES.status))) ?? "";
    if (text.length > 200 && !text.includes("录入中")) {
      stage = "finalized";
    } else if (interview && interviewAnswered) {
      stage = "stage3";
    } else if (interview) {
      stage = "stage2-pending";
    } else if (discovery) {
      stage = "stage2";
    } else {
      stage = "stage1";
    }
  } else if (interview && interviewAnswered) {
    stage = "stage3";
  } else if (interview) {
    stage = "stage2-pending";
  } else if (discovery) {
    stage = "stage2";
  } else {
    stage = "stage1";
  }

  return {
    productId,
    stage,
    files: {
      intake,
      discovery,
      interview,
      interviewAnswered,
      status: statusFile,
      archived
    }
  };
}

export const INTAKE_FILES = FILES;
