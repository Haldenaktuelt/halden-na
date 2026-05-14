import {
  db,
  collection,
  doc,
  setDoc,
  serverTimestamp,
  COLLECTIONS
} from "../../00_firebase/firebase-db.js";

document.addEventListener("DOMContentLoaded", () => {
  const defaultStories = window.HALDEN_NA_SAKER || [];
  const defaultPartners = window.HALDEN_NA_PARTNERE || [];

  let published = JSON.parse(localStorage.getItem("hn_published") || "null") || defaultStories;
  let drafts = JSON.parse(localStorage.getItem("hn_drafts") || "[]");
  let partners = JSON.parse(localStorage.getItem("hn_partners") || "null") || defaultPartners;
  let sources = JSON.parse(localStorage.getItem("hn_sources") || "[]");
  let activeDraftIndex = null;

  const $ = (id) => document.getElementById(id);
  const exists = (id) => !!$(id);

  function save(){
    localStorage.setItem("hn_published", JSON.stringify(published));
    localStorage.setItem("hn_drafts", JSON.stringify(drafts));
    localStorage.setItem("hn_partners", JSON.stringify(partners));
    localStorage.setItem("hn_sources", JSON.stringify(sources));
  }

  function nowTime(){
    return new Date().toLocaleTimeString("no-NO", { hour:"2-digit", minute:"2-digit" });
  }

  function nowIso(){
    return new Date().toISOString();
  }

  function localDateTimeToIso(value){
    if(!value) return nowIso();
    const d = new Date(value);
    return isNaN(d.getTime()) ? nowIso() : d.toISOString();
  }

  function isoToLocalDateTime(value){
    if(!value) return "";
    const d = new Date(value);
    if(isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function makeId(prefix){
    return prefix + "-" + Date.now();
  }

  function normalizeStoryId(story){
    if(story.id) return story.id;
    return makeId("sak");
  }

  function escapeText(s){
    return String(s || "").replace(/[&<>"']/g, (m) => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#039;"
    }[m]));
  }

  function value(id, fallback = ""){
    return exists(id) ? $(id).value : fallback;
  }

  function checked(id){
    return exists(id) ? $(id).checked === true : false;
  }

  function categoryFromType(type){
    if(type === "Vei / Trafikk") return "Trafikk";
    return type || "Lokalt";
  }

  function normalizeStory(story){
    const bilde = story.bildeUrl || story.bilde || "";
    const video = story.videoUrl || story.video || "";
    const mediaPlassering = story.mediaPlassering || story.mediaPlacement || "top";
    const kilde = story.kilde || story.sourceType || "";
    const sourceUrl = story.sourceUrl || story.kildeUrl || "";
    const dato = story.dato || nowIso();

    return {
      ...story,
      id: normalizeStoryId(story),
      kategori: story.kategori || "Lokalt",
      tittel: story.tittel || "",
      ingress: story.ingress || "",
      tekst: story.tekst || "",
      bildeUrl: bilde,
      videoUrl: video,
      mediaPlassering,
      kilde,
      sourceUrl,
      status: story.status || "til_godkjenning",
      dato,
      tid: story.tid || nowTime(),
      hovedsak: story.hovedsak === true,

      bilde,
      video,
      mediaPlacement: mediaPlassering,
      sourceType: kilde
    };
  }

  function readNewStoryForm(){
    const kategori = categoryFromType(value("sourceType", "Lokalt"));
    const tittel = value("newTitle", "").trim();
    const ingress = value("newIngress", "").trim();
    const tekst = value("newText", "").trim();
    const raw = value("rawInput", "").trim();
    const bildeUrl = value("rawImage", "").trim();
    const videoUrl = value("rawVideo", "").trim();
    const mediaPlassering = value("mediaPlacement", "top");
    const kilde = value("customSourceType", "").trim();
    const sourceUrl = value("sourceUrl", "").trim();
    const dato = localDateTimeToIso(value("newDate", ""));

    return normalizeStory({
      id: makeId("sak"),
      kategori,
      tittel,
      ingress,
      tekst: tekst || raw,
      bildeUrl,
      videoUrl,
      mediaPlassering,
      kilde,
      sourceUrl,
      status: "til_godkjenning",
      dato,
      tid: nowTime(),
      hovedsak: checked("mainStory"),
      rawInput: raw
    });
  }

  function renderPreview(targetId, draft){
    if(!exists(targetId)) return;

    if(!draft){
      $(targetId).innerHTML = `<div class="previewEmpty">Ingen kladd ennå.</div>`;
      return;
    }

    const d = normalizeStory(draft);

    const media = d.videoUrl
      ? `<video src="${escapeText(d.videoUrl)}" controls></video>`
      : d.bildeUrl
        ? `<img src="${escapeText(d.bildeUrl)}" alt="">`
        : "";

    $(targetId).innerHTML = `
      <div class="hnPreview">
        ${d.mediaPlassering === "top" ? media : ""}
        <div class="kicker">${escapeText(d.kategori)}${d.hovedsak ? " · Hovedsak" : ""}</div>
        <h2>${escapeText(d.tittel || "Uten tittel")}</h2>
        <p><b>${escapeText(d.ingress)}</b></p>
        <p>${escapeText(d.tekst)}</p>
        ${d.kilde ? `<p><small>Kilde: ${escapeText(d.kilde)}</small></p>` : ""}
        ${d.mediaPlassering === "bottom" ? media : ""}
      </div>
    `;
  }

  function switchTab(tabId){
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === tabId));
  }

  async function saveStoryToFirebase(story){
    const cleanStory = normalizeStory(story);
    cleanStory.status = cleanStory.status || "publisert";

    await setDoc(doc(db, COLLECTIONS.saker, cleanStory.id), {
      ...cleanStory,
      oppdatertAt: serverTimestamp()
    }, { merge: true });
  }

  async function saveDraftToFirebase(story){
    const cleanStory = normalizeStory(story);
    cleanStory.status = cleanStory.status || "til_godkjenning";

    await setDoc(doc(db, COLLECTIONS.kladder, cleanStory.id), {
      ...cleanStory,
      oppdatertAt: serverTimestamp()
    }, { merge: true });
  }

  function renderLists(){
    if(exists("approvalList")){
      $("approvalList").innerHTML = drafts.length ? "" : `<div class="previewEmpty">Ingen saker til godkjenning.</div>`;

      drafts.forEach((d, i) => {
        const story = normalizeStory(d);
        const item = document.createElement("div");
        const main = story.hovedsak ? " · Hovedsak" : "";

        item.className = "listItem";
        item.innerHTML = `
          <small>${escapeText(story.tid)} · ${escapeText(story.kategori)}${main} · ${escapeText(story.kilde || "")}</small>
          <h3>${escapeText(story.tittel || "Uten tittel")}</h3>
          <p>${escapeText(story.ingress)}</p>
        `;
        item.addEventListener("click", () => openEditor(i));
        $("approvalList").appendChild(item);
      });
    }

    if(exists("publishedList")){
      $("publishedList").innerHTML = published.length ? "" : `<div class="previewEmpty">Ingen publiserte saker.</div>`;

      published.forEach((d, i) => {
        const story = normalizeStory(d);
        const item = document.createElement("div");
        const main = story.hovedsak ? " · Hovedsak" : "";

        item.className = "listItem";
        item.innerHTML = `
          <small>${escapeText(story.tid)} · ${escapeText(story.kategori)} · Publisert${main}</small>
          <h3>${escapeText(story.tittel || "Uten tittel")}</h3>
          <p>${escapeText(story.ingress)}</p>
          <div class="itemActions">
            <button type="button" class="warn" data-unpublish="${i}">Trekk tilbake</button>
          </div>
        `;
        $("publishedList").appendChild(item);
      });

      document.querySelectorAll("[data-unpublish]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();

          const index = Number(btn.dataset.unpublish);
          const story = normalizeStory(published.splice(index, 1)[0]);

          story.status = "til_godkjenning";
          drafts.unshift(story);

          try{
            await saveDraftToFirebase(story);
            await saveStoryToFirebase(story);
            console.log("Sak trukket tilbake uten ny ID");
          }catch(err){
            console.error("Firebase-feil:", err);
          }

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
        item.innerHTML = `
          <small>${escapeText(p.niva)} · ${escapeText(p.size)} · ${escapeText(p.start || "")} – ${escapeText(p.slutt || "")}</small>
          <h3>${escapeText(p.navn)}</h3>
          <p>${escapeText(p.tekst)}</p>
        `;
        item.addEventListener("dblclick", () => {
          if(confirm("Slette partner?")){
            partners.splice(i, 1);
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

    if(exists("status")){
      $("status").textContent = `${drafts.length} til godkjenning · ${published.length} publisert · ${partners.length} partnere · ${sources.length} kilder`;
    }
  }

  function openEditor(index){
    activeDraftIndex = index;
    const d = normalizeStory(drafts[index]);

    if(exists("editKategori")) $("editKategori").value = d.kategori || "Lokalt";
    if(exists("editTittel")) $("editTittel").value = d.tittel || "";
    if(exists("editIngress")) $("editIngress").value = d.ingress || "";
    if(exists("editTekst")) $("editTekst").value = d.tekst || "";
    if(exists("editBilde")) $("editBilde").value = d.bildeUrl || "";
    if(exists("editVideo")) $("editVideo").value = d.videoUrl || "";
    if(exists("editMediaPlacement")) $("editMediaPlacement").value = d.mediaPlassering || "top";
    if(exists("editSourceType")) $("editSourceType").value = d.kilde || "";
    if(exists("editSourceUrl")) $("editSourceUrl").value = d.sourceUrl || "";
    if(exists("editTid")) $("editTid").value = d.tid || nowTime();
    if(exists("editMainStory")) $("editMainStory").checked = d.hovedsak === true;

    updateEditorPreview();

    if(exists("editorModal")){
      $("editorModal").classList.add("open");
    }
  }

  function readEditor(){
    const base = drafts[activeDraftIndex] || {};
    const mediaPlassering = value("editMediaPlacement", "top");
    const bildeUrl = value("editBilde", "");
    const videoUrl = value("editVideo", "");
    const kilde = value("editSourceType", "");

    return normalizeStory({
      ...base,
      id: normalizeStoryId(base),
      kategori: value("editKategori", "Lokalt"),
      tittel: value("editTittel", ""),
      ingress: value("editIngress", ""),
      tekst: value("editTekst", ""),
      bildeUrl,
      videoUrl,
      mediaPlassering,
      kilde,
      sourceUrl: value("editSourceUrl", ""),
      tid: value("editTid", nowTime()),
      dato: base.dato || nowIso(),
      hovedsak: checked("editMainStory")
    });
  }

  function updateEditorPreview(){
    if(activeDraftIndex === null) return;
    renderPreview("hnPreview", readEditor());
  }

  function clearNewStoryForm(){
    [
      "newTitle",
      "newIngress",
      "newText",
      "rawInput",
      "customSourceType",
      "sourceUrl",
      "rawImage",
      "rawVideo",
      "newDate"
    ].forEach(id => {
      if(exists(id)) $(id).value = "";
    });

    if(exists("mainStory")) $("mainStory").checked = false;
    renderPreview("draftPreview", null);
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  if(exists("makeDraft")){
    $("makeDraft").addEventListener("click", async () => {
      const story = readNewStoryForm();

      if(!story.tittel && !story.ingress && !story.tekst){
        alert("Skriv minst tittel, ingress eller brødtekst først.");
        return;
      }

      drafts.unshift(story);

      try{
        await saveDraftToFirebase(story);
      }catch(err){
        console.error("Firebase-feil ved lagring av kladd:", err);
      }

      renderPreview("draftPreview", story);
      renderAll();
      switchTab("godkjenning");
    });
  }

  if(exists("clearRaw")){
    $("clearRaw").addEventListener("click", clearNewStoryForm);
  }

  if(exists("closeEditor")){
    $("closeEditor").addEventListener("click", () => $("editorModal").classList.remove("open"));
  }

  if(exists("editorModal")){
    $("editorModal").addEventListener("click", (e) => {
      if(e.target.id === "editorModal"){
        $("editorModal").classList.remove("open");
      }
    });
  }

  [
    "editKategori",
    "editSourceType",
    "editSourceUrl",
    "editTid",
    "editTittel",
    "editIngress",
    "editTekst",
    "editBilde",
    "editVideo",
    "editMediaPlacement",
    "editMainStory"
  ].forEach(id => {
    if(exists(id)) {
      const eventType = id === "editMainStory" ? "change" : "input";
      $(id).addEventListener(eventType, updateEditorPreview);
    }
  });

  [
    "sourceType",
    "newTitle",
    "newIngress",
    "newText",
    "rawImage",
    "rawVideo",
    "mediaPlacement",
    "customSourceType",
    "sourceUrl",
    "newDate",
    "mainStory"
  ].forEach(id => {
    if(exists(id)) {
      const eventType = id === "mainStory" ? "change" : "input";
      $(id).addEventListener(eventType, () => {
        const story = readNewStoryForm();
        renderPreview("draftPreview", story);
      });
    }
  });

  if(exists("saveDraftChanges")){
    $("saveDraftChanges").addEventListener("click", async () => {
      if(activeDraftIndex === null) return;

      drafts[activeDraftIndex] = readEditor();
      drafts[activeDraftIndex].status = "til_godkjenning";

      try{
        await saveDraftToFirebase(drafts[activeDraftIndex]);
      }catch(err){
        console.error("Firebase-feil ved lagring:", err);
      }

      renderAll();
      alert("Lagret.");
    });
  }

  if(exists("approveDraft")){
    $("approveDraft").addEventListener("click", async () => {
      if(activeDraftIndex === null) return;

      const story = readEditor();
      story.status = "publisert";

      const existingIndex = published.findIndex(s => s.id === story.id);

      if(existingIndex >= 0){
        published[existingIndex] = story;
      }else{
        published.unshift(story);
      }

      drafts.splice(activeDraftIndex, 1);
      activeDraftIndex = null;

      try{
        await saveStoryToFirebase(story);
      }catch(err){
        console.error("Publiserings-feil:", err);
      }

      if(exists("editorModal")){
        $("editorModal").classList.remove("open");
      }

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

        if(exists("editorModal")){
          $("editorModal").classList.remove("open");
        }

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

      ["partnerName", "partnerLogoText", "partnerLogoUrl", "partnerText", "partnerUrl", "partnerStart", "partnerEnd"].forEach(id => {
        if(exists(id)) $(id).value = "";
      });

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

      ["sourceName", "sourceLink", "sourceInstruction"].forEach(id => {
        if(exists(id)) $(id).value = "";
      });

      renderAll();
    });
  }

  async function copyText(id){
    await navigator.clipboard.writeText($(id).textContent);
    alert("Kopiert.");
  }

  function downloadText(id, filename, type = "application/javascript"){
    const blob = new Blob([$(id).textContent], { type });
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