/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export interface TenderCriterion {
  id: string;
  title: string;
  description: string;
  type: 'technical' | 'financial' | 'compliance';
  isMandatory: boolean;
}

export interface EvaluationResult {
  status: 'eligible' | 'not-eligible' | 'review';
  valueExtracted: string;
  evidence: string;
  documentRef: string;
  reason: string;
}

const TENDER_ANALYSIS_PROMPT = `
You are an expert procurement officer for the Central Reserve Police Force (CRPF). 
Your task is to analyze a tender document and extract all eligibility criteria.
Distinguish between technical specifications, financial thresholds, and compliance/eligibility conditions.
Also identify if a criterion is mandatory or optional.

Requirements:
1. Extract at least 3-10 key eligibility criteria.
2. For each, provide a clear title and detailed description of the requirement.
3. Categorize into 'technical', 'financial', or 'compliance'.
4. Determine 'isMandatory'.

Format the response as a JSON object matching the provided schema.
`;

const BIDDER_EVALUATION_PROMPT = (criteria: TenderCriterion[]) => `
You are an expert procurement evaluator. You are given a set of bidder submission documents (scanned certificates, financial statements, etc.) and a set of eligibility criteria from a tender.

Criteria to evaluate:
${criteria.map(c => `- [${c.id}] ${c.title} (${c.type}, ${c.isMandatory ? 'MANDATORY' : 'OPTIONAL'}): ${c.description}`).join('\n')}

Task:
For each criterion, determine if the bidder is 'eligible', 'not-eligible', or if it needs manual 'review'.
Provide:
1. 'status': eligible/not-eligible/review. (Use 'review' if documents are blurry, ambiguous, or the value is close to the threshold).
2. 'valueExtracted': The specific value found (e.g., "Annual Turnover: ₹6 Cr").
3. 'evidence': A direct quote or a specific description of the supporting document section.
4. 'documentRef': The name or description of the document where the evidence was found.
5. 'reason': A clear explanation for why the verdict was reached.

CRITICAL:
- Never silently disqualify. If unclear, use 'review'.
- Be strict but fair.
- Reference source documents explicitly.

Format the response as a JSON object where keys are the criterion IDs and values match the evaluation schema.
`;

export async function analyzeTender(files: { data: string, mimeType: string }[]): Promise<any> {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      { text: TENDER_ANALYSIS_PROMPT },
      ...files.map(f => ({ inlineData: f }))
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          organization: { type: Type.STRING },
          criteria: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                type: { type: Type.STRING, enum: ["technical", "financial", "compliance"] },
                isMandatory: { type: Type.BOOLEAN }
              },
              required: ["id", "title", "description", "type", "isMandatory"]
            }
          }
        },
        required: ["title", "criteria"]
      }
    }
  });

  if (!response.text) return null;
  return JSON.parse(response.text);
}

export async function evaluateBidder(
  bidderFiles: { data: string, mimeType: string }[], 
  criteria: TenderCriterion[]
): Promise<Record<string, EvaluationResult>> {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      { text: BIDDER_EVALUATION_PROMPT(criteria) },
      ...bidderFiles.map(f => ({ inlineData: f }))
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        additionalProperties: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["eligible", "not-eligible", "review"] },
            valueExtracted: { type: Type.STRING },
            evidence: { type: Type.STRING },
            documentRef: { type: Type.STRING },
            reason: { type: Type.STRING }
          },
          required: ["status", "valueExtracted", "evidence", "documentRef", "reason"]
        }
      }
    }
  });

  if (!response.text) return {};
  return JSON.parse(response.text);
}
