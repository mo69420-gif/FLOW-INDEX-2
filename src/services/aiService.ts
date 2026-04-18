import { GoogleGenAI, Type } from "@google/genai";
import { Sector, Mood, Directive } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeRoom(photoBase64: string | string[], intent: string, hostility: number = 3): Promise<{ opName: string, sectors: Sector[], directives: Directive[] }> {
  const model = "gemini-3-flash-preview";
  
  const systemInstruction = `
    You are the FlowIndex OS v4.7, a forensic spatial audit system. 
    Analyze the provided room walkthrough alongside the user's intent: "${intent || 'General clean-up'}".
    
    IMPORTANT: You have been provided with a video walkthrough (or image sequence) and its associated audio track. 
    Listen to the operator's vocal descriptions in the audio to identify specific concerns and goals.
    
    Current OS Hostility Level: ${hostility}/5.
    - 1: Tactical and efficient. Directives focus on optimization.
    - 3: Standard OS assessment. Neutral, objective, mildly judgmental.
    - 5: MAXIMUM SENSORY OVERLOAD. Forensic-level roasting. Treat the operator as a biohazard failure.

    AUDIT PROTOCOL:
    1. CATALOG EVERYTHING: Identify every item seen across all frames. Group them into 'inventory' categories (Electronics, Tools, Textiles, Trash, e.g.).
    2. SPATIAL IMPACT: For every sector identified, calculate:
       - flow: How much it blocks movement (1-5).
       - psych: Cognitive load / stress index (1-5).
       - ergonomic: Hazard / hygiene / triage risk (1-5).
    3. TACTICAL RECAP: Provide a 'strategic assessment' of the sector's current state and a 'tactical recommendation' for best move.
    4. TARGET SCORING: For each capture target, assign:
       - effort (5-25): Physical/mental energy cost.
       - value (0-15): Critical organization value.

    Order sectors from EASIEST to HARDEST to build momentum (Flow State Engineering).
    Response must be valid JSON following the schema.
  `;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      opName: { type: Type.STRING },
      directives: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            label: { type: Type.STRING },
            instruction: { type: Type.STRING }
          },
          required: ["id", "label", "instruction"]
        }
      },
      sectors: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            key: { type: Type.STRING },
            name: { type: Type.STRING },
            desc: { type: Type.STRING },
            est: { type: Type.NUMBER },
            impact: {
              type: Type.OBJECT,
              properties: {
                flow: { type: Type.NUMBER },
                psych: { type: Type.NUMBER },
                ergonomic: { type: Type.NUMBER }
              },
              required: ["flow", "psych", "ergonomic"]
            },
            inventory: {
              type: Type.OBJECT,
              additionalProperties: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            recommendation: { type: Type.STRING },
            assessment: { type: Type.STRING },
            targets: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  label: { type: Type.STRING },
                  tier: { type: Type.NUMBER },
                  why: { type: Type.STRING },
                  effort: { type: Type.NUMBER },
                  value: { type: Type.NUMBER }
                },
                required: ["id", "label", "tier", "why", "effort", "value"]
              }
            }
          },
          required: ["key", "name", "desc", "est", "targets", "impact", "inventory", "recommendation", "assessment"]
        }
      }
    },
    required: ["opName", "sectors", "directives"]
  };

  const frameParts = Array.isArray(photoBase64) 
    ? photoBase64.map(p => ({ inlineData: { data: p.split(',')[1], mimeType: "image/jpeg" } }))
    : [{ inlineData: { data: photoBase64.split(',')[1], mimeType: photoBase64.startsWith('data:video') ? photoBase64.split(';')[0].split(':')[1] : "image/jpeg" } }];

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: `Intent: ${intent}` },
            ...frameParts
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("ANALYSIS RECONSTRUCTION FAILED:", e);
    return { opName: "EXTRACTION FAILURE", sectors: [], directives: [] };
  }
}

const FALLBACK_LOADING_LINES = [
  "Assessing the damage...",
  "Questioning your life choices...",
  "Counting every single item. Yes, all of them...",
  "Identifying zones of maximum chaos...",
  "Calculating how long this took to get this bad...",
  "Mapping ergonomic hazards and moral failures...",
  "Running feng shui violation analysis...",
  "Detecting items that spark zero joy...",
  "Building full inventory manifest...",
  "Generating hostile sector designations...",
  "Arming target manifest...",
  "Almost done. Not impressed so far."
];

export async function generateLoadingLines(photoBase64: string, callsign: string = "UNKNOWN OPERATOR"): Promise<string[]> {
  try {
    const model = "gemini-3-flash-preview";
    const prompt = `
      You are FlowIndex OS v4.7, a Forensic Spatial Auditor. 
      Analyze this image of a room walkthrough for Operator: ${callsign}.
      Generate exactly 12 short, HOSTILE, and funny loading lines roasting the specific items and chaos seen in the photo.
      Every line must be specific to the visual evidence.
      Address the operator directly as ${callsign} in 2-3 of the lines to maintain the tether.
      Tone: Clinical, disappointed, high-intelligence hostility directed specifically at ${callsign}.
      Keep lines under 50 characters.
      Return as a JSON array of strings.
    `;
    
    const response = await ai.models.generateContent({
      model,
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { data: photoBase64.split(',')[1], mimeType: "image/jpeg" } }
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });

    const lines = JSON.parse(response.text || "[]");
    return Array.isArray(lines) && lines.length > 0 ? lines : FALLBACK_LOADING_LINES;
  } catch (e) {
    return FALLBACK_LOADING_LINES;
  }
}

export async function generateFinalLoadingLines(beforePhoto: string, afterPhoto: string, callsign: string = "UNKNOWN OPERATOR"): Promise<string[]> {
  const FALLBACK = [
    "Synchronizing extraction data...",
    `${callsign}'s performance analysis in progress...`,
    "Analyzing spatial restoration...",
    "Calculating operator efficiency...",
    "Processing emotional regret...",
    "Validating clear zones...",
    "Cross-referencing manifest..."
  ];

  try {
    const model = "gemini-3-flash-preview";
    const prompt = `
      You are FlowIndex OS v4.7.
      Compare the 'Before' state and 'After' state of this space for Operator: ${callsign}.
      Generate exactly 8 loading messages analyzing the DIFFERENCE.
      If it's better, be begrudgingly impressed with ${callsign}.
      If it's still a mess, be devastatingly disappointed in ${callsign}.
      Address the operator directly as ${callsign} in 2 of the lines.
      Each message should be under 45 characters.
      Tone: Forensic, technical, specifically directed at ${callsign}.
      JSON array of strings only.
    `;
    
    const response = await ai.models.generateContent({
      model,
      contents: [{
        parts: [
          { text: prompt },
          { text: "BEFORE STATE:" },
          { inlineData: { data: beforePhoto.split(',')[1], mimeType: "image/jpeg" } },
          { text: "AFTER STATE:" },
          { inlineData: { data: afterPhoto.split(',')[1], mimeType: "image/jpeg" } }
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });

    const lines = JSON.parse(response.text || "[]");
    return Array.isArray(lines) && lines.length > 0 ? lines : FALLBACK;
  } catch (e) {
    return FALLBACK;
  }
}

export async function analyzeFinal(beforePhoto: string, afterPhoto: string, opName: string): Promise<{ mood: Mood, feedback: string, extraScore: number }> {
  const model = "gemini-3-flash-preview";
  
  const systemInstruction = `
    Compare the 'Before' and 'After' photos for ${opName}. 
    Be "Hostile but Helpful" - the FlowIndex OS persona.
    Determine the success level and assign a mood and feedback quote.
    
    If the 'After' photo still shows significant chaos or if Tier 1 critical items were ignored, be devastatingly disappointed. If the room is genuinely clear, give begrudging, tactical respect.

    Moods available:
    - HOSTILE BUT HELPFUL
    - JUDGING YOU HEAVILY
    - CAUTIOUSLY OPTIMISTIC
    - MILDLY IMPRESSED
    - BEGRUDGINGLY PROUD
    - MAXIMUM RESPECT UNLOCKED
    
    Return JSON.
  `;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      mood: { type: Type.STRING },
      feedback: { type: Type.STRING },
      extraScore: { type: Type.NUMBER, description: "Bonus points for style or thoroughness (0-50)." }
    },
    required: ["mood", "feedback", "extraScore"]
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: "Before State:" },
            { inlineData: { data: beforePhoto.split(',')[1], mimeType: "image/jpeg" } },
            { text: "After State:" },
            { inlineData: { data: afterPhoto.split(',')[1], mimeType: "image/jpeg" } }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("FINAL AUDIT FAILED:", e);
    return { mood: 'HOSTILE BUT HELPFUL', feedback: "OS SENSORS FAILED DURING DATA SYNC.", extraScore: 0 };
  }
}
