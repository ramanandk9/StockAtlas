"use strict";

// Navigation is shared by the explorer and research; bookmarks use the same
// browser storage key so the badge stays visible across both workspaces.
(() => {
  function readSavedIds() {
    let saved = new Set();
    try {
      const ids = JSON.parse(localStorage.getItem("atlas.saved") || "[]");
      if (Array.isArray(ids)) {
        saved = new Set(ids.filter((id) => typeof id === "string"));
      }
    } catch {
      // Storage can be unavailable or contain an invalid old value.
    }
    return saved;
  }

  function updateSavedCount() {
    const saved = readSavedIds();
    const count = saved.size;
    document.querySelectorAll("[data-research-save]").forEach((button) => {
      const isSaved = saved.has(button.dataset.researchSave);
      const name = button.dataset.companyName || button.dataset.researchSave;
      button.classList.toggle("saved", isSaved);
      button.textContent = isSaved ? "★" : "☆";
      button.setAttribute("aria-pressed", String(isSaved));
      button.setAttribute(
        "aria-label",
        `${isSaved ? "Unsave" : "Save"} ${name}`,
      );
      button.title = `${isSaved ? "Remove from" : "Add to"} Saved`;
    });
    const badge = document.getElementById("saved-count");
    if (badge) {
      badge.textContent = count;
      badge.setAttribute("aria-label", `${count} saved organisations`);
    }
  }

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest("[data-research-save]");
      if (!button) return;
      // Handle the star before the screener row's open-company click handler.
      event.preventDefault();
      event.stopPropagation();
      const saved = readSavedIds();
      const id = button.dataset.researchSave;
      if (saved.has(id)) saved.delete(id);
      else saved.add(id);
      try {
        localStorage.setItem("atlas.saved", JSON.stringify([...saved]));
      } catch {
        button.textContent = "!";
        button.title = "Cannot save: browser storage is unavailable";
        button.setAttribute("aria-label", button.title);
        return;
      }
      window.dispatchEvent(new Event("stockatlas:saved-change"));
    },
    true,
  );

  updateSavedCount();
  window.addEventListener("pageshow", updateSavedCount);
  window.addEventListener("focus", updateSavedCount);
  window.addEventListener("stockatlas:saved-change", updateSavedCount);
  window.addEventListener("stockatlas:research-render", updateSavedCount);
  window.addEventListener("storage", (event) => {
    if (event.key === "atlas.saved" || event.key === null) updateSavedCount();
  });

  let freshnessPending = false;
  async function updateFreshness() {
    if (freshnessPending) return;
    freshnessPending = true;
    const badge = document.getElementById("data-freshness");
    if (!badge) {
      freshnessPending = false;
      return;
    }
    const date = document.getElementById("data-updated-date");
    const progress = document.getElementById("data-refresh-progress");
    const formatDate = (value) =>
      new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }).format(new Date(value));
    const formatTime = (value) =>
      value
        ? new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Kolkata",
          }).format(new Date(value * 1000)) + " IST"
        : "not recorded";
    try {
      const response = await window.StockAtlasData.fetch("/api/freshness", { cache: "no-store" });
      if (!response.ok) throw Error("Freshness unavailable");
      const data = await response.json();
      const refresh = data.refresh || {};
      const completed = refresh.completedAt && !refresh.running;
      const updated =
        completed && refresh.pricesUpdated && refresh.modelsUpdated
          ? refresh.completedAt
          : data.pricesFetchedAt;
      date.textContent = updated
        ? "Updated " + formatDate(updated * 1000)
        : "Data date unavailable";
      progress.hidden =
        !refresh.running &&
        refresh.status !== "partial" &&
        refresh.status !== "error";
      progress.textContent = refresh.running
        ? "Refreshing data & models…"
        : refresh.status === "partial"
          ? refresh.pricesUpdated && refresh.modelsUpdated
            ? `Statements ${refresh.financialsUpdated}/${data.totalCompanies}`
            : "Partial refresh"
          : refresh.status === "error"
            ? "Refresh needs attention"
            : "";
      badge.classList.toggle("refreshing", !!refresh.running);
      badge.classList.toggle(
        "partial",
        !refresh.running && ["partial", "error"].includes(refresh.status),
      );
      badge.title = [
        (data.staticSnapshot ? "Published snapshot. Prices through: " : "Prices through: ") + (data.priceAsOf || "unavailable"),
        "Price download: " + formatTime(data.pricesFetchedAt),
        "Models through: " + (data.modelsAsOf || "unavailable"),
        "Model computation: " + formatTime(data.modelsComputedAt),
        refresh.phase || "",
        ...(refresh.warnings || []),
      ]
        .filter(Boolean)
        .join("\n");
    } catch {
      date.textContent = "Data date unavailable";
      badge.title = "Unable to read the cached data update status.";
      progress.hidden = true;
    } finally {
      freshnessPending = false;
    }
  }
  updateFreshness();
  window.addEventListener("focus", updateFreshness);
  if (!window.STOCKATLAS_STATIC) setInterval(updateFreshness, 15000);
})();
