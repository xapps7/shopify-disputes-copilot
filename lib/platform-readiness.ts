export type SetupReadinessItem = {
  key: string;
  label: string;
  status: "ready" | "attention" | "blocked";
  detail: string;
};

export function getSetupReadiness() {
  const storageMode = process.env.FILE_STORAGE_MODE ?? "local";
  const protectedDataApproved = process.env.SHOPIFY_PROTECTED_DATA_APPROVED === "true";
  const aiDraftsEnabled = Boolean(process.env.OPENAI_API_KEY);

  const items: SetupReadinessItem[] = [
    {
      key: "storage",
      label: "File storage",
      status: storageMode === "local" ? "attention" : "ready",
      detail:
        storageMode === "local"
          ? "Uploads and packets still use local disk. Move to S3-compatible storage before production launch."
          : `Storage mode is ${storageMode}.`
    },
    {
      key: "protected_data",
      label: "Protected customer data",
      status: protectedDataApproved ? "ready" : "blocked",
      detail: protectedDataApproved
        ? "Protected customer data approval is marked complete."
        : "Protected customer data approval is still pending, so dispute webhooks remain limited."
    },
    {
      key: "manual_submission",
      label: "Submission path",
      status: "attention",
      detail:
        "The app supports packet export and manual submission recording. Direct in-app submission is not enabled."
    },
    {
      key: "ai_drafts",
      label: "AI drafts",
      status: aiDraftsEnabled ? "ready" : "attention",
      detail: aiDraftsEnabled
        ? "Model-backed drafting is enabled."
        : "The app will use deterministic draft generation until OPENAI_API_KEY is configured."
    }
  ];

  return items;
}
