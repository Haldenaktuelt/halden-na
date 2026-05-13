document.addEventListener("DOMContentLoaded", () => {
  const defaultStories = window.HALDEN_NA_SAKER || [];
  const defaultPartners = window.HALDEN_NA_PARTNERE || [];

  let published = JSON.parse(localStorage.getItem("hn_published") || "null") || defaultStories;
  let drafts = JSON.parse(localStorage.getItem("hn_drafts") || "[]");
  let partners = JSON.parse(localStorage.getItem("hn_partners") || "null") || defaultPartners;
  let sources = JSON.parse(localStorage.getItem("hn_sources") || "[]");
  let activeDraftIndex = null;

  const $ = (id) => document.getElementById(id);

  function exists(id){ return !!$(id); }

  function save(){
    localStorage.setItem("hn_published", JSON.stringify(published));
    localStorage.setItem("hn_drafts", JSON.stringify(drafts));
    localStorage.setItem("hn_partners", JSON.stringify(partners));
    localStorage.setItem("hn_sources", JSON.stringify(sources));
  }

  function nowTime(){
    return new Date().toLocaleTimeString("no-NO", {hour:"2-digit", minute:"2-digit"});
  }

  function makeId(prefix){
    return prefix + "-" + Date.now();
  }

  function escapeText(s){
    return String(s || "").replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }

  function value(id, fallback=""){
    return exists(id) ? $(id).value : fallback;
  }

  function categoryFromType(type){
    if(type === "Øst 110") return "Politilogg";
    if(type === "Egendefinert") return "Kort forklart";
    return type || "Kort forklart";
  }

  function makeLocalAiDraft(raw){
    const type = value("sourceType", "Kort forklart");
    const customType = value("customSourceType", "");
    const sourceUrl = value("sourceUrl", "");
    const image = value("rawImage", "");
    const video = value("rawVideo", "");
    const mediaPlacement = value("mediaPlacement", "top");

    const clean = raw.trim().replace(/\s+/g, " ");
    const firstSentence = clean.split(/[.!?]/).filter(Boolean)[0] || clean.slice(0, 90);
    const kategori = categoryFromType(type);
    const sourceType = type === "Egendefinert" ? customType : type;

    let prefix = "Kort forklart";
    if(kategori === "Kommune") prefix = "Kommunal sak";
    if(kategori === "Politilogg") prefix = "Hendelse";
    if(kategori === "Arrangement") prefix = "Dette skjer";
    if(kategori === "Vei / Trafikk") prefix = "Trafikk";
    if(kategori === "Norge & Verden") prefix = "Norge & Verden";

    return {
      id: makeId("draft"),
      tid: nowTime(),
      kategori,
      sourceType: sourceType || type,
      sourceUrl,
      tittel: `${prefix}: ${firstSentence}`.slice(0, 88),
      ingress: clean.slice(0, 170) + (clean.length > 170 ? "..." : ""),
      tekst: `Kort forklart:\n\n${raw.trim()}\n\nKontroll før publisering:\n• Sjekk fakta\n• Sjekk dato/sted\n• Sjekk kilde\n• Fjern usikker informasjon\n• Godkjenn tittel og ingress`,
      bilde: image,
      video,
      mediaPlacement,
      status: "til_godkjenning"
    };
  }

  function renderPreview(targetId, draft){
    if(!exists(targetId)) return;

    if(!draft){
      $(targetId).innerHTML = `<div class="previewEmpty">Ingen kladd ennå.</div>`;
      return;
    }

    const media = draft.video ? `<video src="${escapeText(draft.video)}" controls></video>` : draft.bilde ? `<img src="${escapeText(draft.bilde)}" alt="">` : "";

    $(targetId).innerHTML = `
      <div class="hnPreview">
        ${draft.mediaPlacement === "top" ? media : ""}
        <div class="kicker">${escapeText(draft.kategori)}</div>
        <h2>${escapeText(draft.tittel)}</h2>
        <p><b>${escapeText(draft.ingress)}</b></p>
        <p>${escapeText(draft.tekst)}</p>
        ${draft.mediaPlacement === "bottom" ? media : ""}
      </div>
    `;
  }

  function switchTab(tabId){
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === tabId));
  }

  function renderLists(){
    if(exists("approvalList")){
      $("approvalList").innerHTML = drafts.length ? "" : `<div class="previewEmpty">Ingen saker til godkjenning.</div>`;
      drafts.forEach((d, i) => {
        const item = document.createElement("div");
        item.className = "listItem";
        item.innerHTML = `<small>${escapeText(d.tid)} · ${escapeText(d.kategori)} · ${escapeText(d.sourceType || "")}</small><h3>${escapeText(d.tittel)}</h3><p>${escapeText(d.ingress)}</p>`;
        item.addEventListener("click", () => openEditor(i));
        $("approvalList").appendChild(item);
      });
    }

    if(exists("publishedList")){
      $("publishedList").innerHTML = published.length ? "" : `<div class="previewEmpty">Ingen publiserte saker.</div>`;
      published.forEach((d, i) => {
        const item = document.createElement("div");
        item.className = "listItem";
        item.innerHTML = `
          <small>${escapeText(d.tid)} · ${escapeText(d.kategori)} · Publisert</small>
          <h3>${escapeText(d.tittel)}</h3>
          <p>${escapeText(d.ingress)}</p>
          <div class="itemActions">
            <button type="button" class="warn" data-unpublish="${i}">Trekk tilbake</button>
          </div>
        `;
        $("publishedList").appendChild(item);
      });

      document.querySelectorAll("[data-unpublish]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const index = Number(btn.dataset.unpublish);
          const story = published.splice(index, 1)[0];
          story.id = String(story.id || makeId("draft")).replace("sak", "draft");
          story.status = "til_godkjenning";
          drafts.unshift(story);
          renderAll();
          switchTab("godkjenning");
        });
      });
    }

    if(exists("partnerList")){
      $("partnerList").innerHTML = partners.length ? "" : `<div class="previewEmpty">Ingen partnere lagt inn.</div>`;
      partners.forEach((p, i) => {
        const item = document.createElement("div");
        item.className = "listItem";
        item.innerHTML = `<small>${escapeText(p.niva)} · ${escapeText(p.size)} · ${escapeText(p.start || "")} – ${escapeText(p.slutt || "")}</small><h3>${escapeText(p.navn)}</h3><p>${escapeText(p.tekst)}</p>`;
        item.addEventListener("dblclick", () => {
          if(confirm("Slette partner?")){
            partners.splice(i,1);
            renderAll();
          }
        });
        $("partnerList").appendChild(item);
      });
    }

    if(exists("sourceList")){
      $("sourceList").innerHTML = sources.length ? "" : `<div class="previewEmpty">Ingen kilder lagt inn.</div>`;
      sources.forEach((s, i) => {
        const item = document.createElement("div");
        item.className = "listItem";
        item.innerHTML = `
          <small>${escapeText(s.kind)} · ${escapeText(s.frequency)}</small>
          <h3>${escapeText(s.name)}</h3>
          <p>${escapeText(s.link)}</p>
          <p>${escapeText(s.instruction)}</p>
          <div class="itemActions">
            <button type="button" class="warn" data-delete-source="${i}">Fjern kilde</button>
          </div>
        `;
        $("sourceList").appendChild(item);
      });

      document.querySelectorAll("[data-delete-source]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          sources.splice(Number(btn.dataset.deleteSource), 1);
          renderAll();
        });
      });
    }
  }

  function renderExports(){
    if(exists("storiesOutput")) $("storiesOutput").textContent = "window.HALDEN_NA_SAKER = " + JSON.stringify(published, null, 2) + ";";
    if(exists("partnersOutput")) $("partnersOutput").textContent = "window.HALDEN_NA_PARTNERE = " + JSON.stringify(partners, null, 2) + ";";
    if(exists("sourcesOutput")) $("sourcesOutput").textContent = JSON.stringify(sources, null, 2);
  }

  function renderAll(){
    save();
    renderLists();
    renderExports();
    if(exists("status")) $("status").textContent = `${drafts.length} til godkjenning · ${published.length} publisert · ${partners.length} partnere · ${sources.length} kilder`;
  }

  function openEditor(index){
    activeDraftIndex = index;
    const d = drafts[index];

    if(exists("editKategori")) $("editKategori").value = d.kategori || "Kort forklart";
    if(exists("editSourceType")) $("editSourceType").value = d.sourceType || "";
    if(exists("editSourceUrl")) $("editSourceUrl").value = d.sourceUrl || "";
    if(exists("editTid")) $("editTid").value = d.tid || nowTime();
    if(exists("editTittel")) $("editTittel").value = d.tittel || "";
    if(exists("editIngress")) $("editIngress").value = d.ingress || "";
    if(exists("editTekst")) $("editTekst").value = d.tekst || "";
    if(exists("editBilde")) $("editBilde").value = d.bilde || "";
    if(exists("editVideo")) $("editVideo").value = d.video || "";
    if(exists("editMediaPlacement")) $("editMediaPlacement").value = d.mediaPlacement || "top";

    updateEditorPreview();
    if(exists("editorModal")) $("editorModal").classList.add("open");
  }

  function readEditor(){
    return {
      ...drafts[activeDraftIndex],
      kategori: value("editKategori", "Kort forklart"),
      sourceType: value("editSourceType", ""),
      sourceUrl: value("editSourceUrl", ""),
      tid: value("editTid", nowTime()),
      tittel: value("editTittel", ""),
      ingress: value("editIngress", ""),
      tekst: value("editTekst", ""),
      bilde: value("editBilde", ""),
      video: value("editVideo", ""),
      mediaPlacement: value("editMediaPlacement", "top")
    };
  }

  function updateEditorPreview(){
    if(activeDraftIndex === null) return;
    renderPreview("hnPreview", readEditor());
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  if(exists("makeDraft")){
    $("makeDraft").addEventListener("click", () => {
      const raw = value("rawInput", "").trim();
      if(!raw){
        alert("Lim inn råtekst først.");
        return;
      }

      const draft = makeLocalAiDraft(raw);
      drafts.unshift(draft);
      renderPreview("draftPreview", draft);
      renderAll();
      switchTab("godkjenning");
    });
  }

  if(exists("clearRaw")){
    $("clearRaw").addEventListener("click", () => {
      ["rawInput","customSourceType","sourceUrl","rawImage","rawVideo"].forEach(id => { if(exists(id)) $(id).value = ""; });
      renderPreview("draftPreview", null);
    });
  }

  if(exists("closeEditor")) $("closeEditor").addEventListener("click", () => $("editorModal").classList.remove("open"));
  if(exists("editorModal")){
    $("editorModal").addEventListener("click", (e) => {
      if(e.target.id === "editorModal") $("editorModal").classList.remove("open");
    });
  }

  ["editKategori","editSourceType","editSourceUrl","editTid","editTittel","editIngress","editTekst","editBilde","editVideo","editMediaPlacement"].forEach(id => {
    if(exists(id)) $(id).addEventListener("input", updateEditorPreview);
  });

  if(exists("saveDraftChanges")){
    $("saveDraftChanges").addEventListener("click", () => {
      if(activeDraftIndex === null) return;
      drafts[activeDraftIndex] = readEditor();
      renderAll();
      alert("Lagret.");
    });
  }

  if(exists("approveDraft")){
    $("approveDraft").addEventListener("click", () => {
      if(activeDraftIndex === null) return;
      const story = readEditor();
      story.id = String(story.id || makeId("sak")).replace("draft", "sak");
      delete story.status;
      published.unshift(story);
      drafts.splice(activeDraftIndex, 1);
      activeDraftIndex = null;
      $("editorModal").classList.remove("open");
      renderAll();
      switchTab("publisert");
    });
  }

  if(exists("deleteDraft")){
    $("deleteDraft").addEventListener("click", () => {
      if(activeDraftIndex === null) return;
      if(confirm("Slette kladden?")){
        drafts.splice(activeDraftIndex, 1);
        activeDraftIndex = null;
        $("editorModal").classList.remove("open");
        renderAll();
      }
    });
  }

  if(exists("addPartner")){
    $("addPartner").addEventListener("click", () => {
      partners.unshift({
        id: makeId("partner"),
        navn: value("partnerName", "Lokal partner") || "Lokal partner",
        logoTekst: value("partnerLogoText", "LOGO") || "LOGO",
        logoUrl: value("partnerLogoUrl", ""),
        tekst: value("partnerText", ""),
        url: value("partnerUrl", ""),
        niva: value("partnerLevel", "partner"),
        size: value("partnerSize", "small"),
        start: value("partnerStart", ""),
        slutt: value("partnerEnd", ""),
        aktiv: true
      });

      ["partnerName","partnerLogoText","partnerLogoUrl","partnerText","partnerUrl","partnerStart","partnerEnd"].forEach(id => { if(exists(id)) $(id).value = ""; });
      renderAll();
    });
  }

  if(exists("addSource")){
    $("addSource").addEventListener("click", () => {
      sources.unshift({
        id: makeId("source"),
        name: value("sourceName", "Uten navn") || "Uten navn",
        kind: value("sourceKind", "URL"),
        link: value("sourceLink", ""),
        instruction: value("sourceInstruction", ""),
        frequency: value("sourceFrequency", "Manuell"),
        active: true
      });

      ["sourceName","sourceLink","sourceInstruction"].forEach(id => { if(exists(id)) $(id).value = ""; });
      renderAll();
    });
  }

  async function copyText(id){
    await navigator.clipboard.writeText($(id).textContent);
    alert("Kopiert.");
  }

  function downloadText(id, filename, type="application/javascript"){
    const blob = new Blob([$(id).textContent], {type});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if(exists("copyStories")) $("copyStories").addEventListener("click", () => copyText("storiesOutput"));
  if(exists("copyPartners")) $("copyPartners").addEventListener("click", () => copyText("partnersOutput"));
  if(exists("copySources")) $("copySources").addEventListener("click", () => copyText("sourcesOutput"));
  if(exists("downloadStories")) $("downloadStories").addEventListener("click", () => downloadText("storiesOutput", "saker.js"));
  if(exists("downloadPartners")) $("downloadPartners").addEventListener("click", () => downloadText("partnersOutput", "partners.js"));
  if(exists("downloadSources")) $("downloadSources").addEventListener("click", () => downloadText("sourcesOutput", "sources.json", "application/json"));

  renderAll();
});
