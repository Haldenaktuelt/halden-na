import {
  db,
  collection,
  doc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  getDocs,
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
  let tips = [];
  let activeDraftIndex = null;

  const $ = (id) => document.getElementById(id);
  const exists = (id) => !!$(id);

  const publishedQuery = query(
    collection(db, COLLECTIONS.saker),
    orderBy("oppdatertAt", "desc")
  );

  onSnapshot(publishedQuery, (snapshot) => {
    const firebasePublished = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      if(data.status === "publisert"){
        firebasePublished.push({
          firebaseId: docSnap.id,
          ...data
        });
      }
    });

    published = firebasePublished;
    save();
    renderAll();
  });
  const tipsQuery = query(
    collection(db, COLLECTIONS.tips),
    orderBy("createdAt", "desc")
  );

  onSnapshot(tipsQuery, (snapshot) => {
    tips = [];

    snapshot.forEach((docSnap) => {
      tips.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    renderAll();
  });

  const partnersQuery = query(
    collection(db, COLLECTIONS.partnere),
    orderBy("oppdatertAt", "desc")
  );

  onSnapshot(partnersQuery, (snapshot) => {
    const firebasePartners = [];

    snapshot.forEach((docSnap) => {
      firebasePartners.push({
        firebaseId: docSnap.id,
        ...docSnap.data()
      });
    });

    partners = firebasePartners;
    save();
    renderAll();
  });


  const sourcesQuery = query(
    collection(db, COLLECTIONS.kilder),
    orderBy("oppdatertAt", "desc")
  );

  onSnapshot(sourcesQuery, (snapshot) => {
    const firebaseSources = [];

    snapshot.forEach((docSnap) => {
      firebaseSources.push({
        firebaseId: docSnap.id,
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    sources = firebaseSources;
    save();
    renderAll();
  });

  function save(){
    localStorage.setItem("hn_published", JSON.stringify(published));
    localStorage.setItem("hn_drafts", JSON.stringify(drafts));
    localStorage.setItem("hn_partners", JSON.stringify(partners));
    localStorage.setItem("hn_sources", JSON.stringify(sources));
  }


  async function refreshDraftsFromFirebase(){
    try{
      const q = query(
        collection(db, COLLECTIONS.saker),
        orderBy("oppdatertAt", "desc")
      );

      const snapshot = await getDocs(q);
      const firebaseDrafts = [];

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();

        if(data.status === "til_godkjenning"){
          firebaseDrafts.push(normalizeStory({
            firebaseId: docSnap.id,
            ...data
          }));
        }
      });

      drafts = firebaseDrafts;
      save();
      renderAll();

      return firebaseDrafts.length;
    }catch(err){
      console.error("Kunne ikke hente kladder direkte:", err);
      return drafts.length;
    }
  }

  function nowTime(){
    return new Date().toLocaleTimeString("no-NO", { hour:"2-digit", minute:"2-digit" });
  }

  function nowIso(){
    return new Date().toISOString();
  }

  function formatDate(value){
    if(!value) return "";

    if(value.toDate){
      const d = value.toDate();
      return d.toLocaleString("no-NO", {
        day:"2-digit",
        month:"2-digit",
        year:"numeric",
        hour:"2-digit",
        minute:"2-digit"
      });
    }

    const d = new Date(value);
    if(isNaN(d.getTime())) return "";

    return d.toLocaleString("no-NO", {
      day:"2-digit",
      month:"2-digit",
      year:"numeric",
      hour:"2-digit",
      minute:"2-digit"
    });
  }

  function localDateTimeToIso(value){
    if(!value) return nowIso();
    const d = new Date(value);
    return isNaN(d.getTime()) ? nowIso() : d.toISOString();
  }

  function makeId(prefix){
    return prefix + "-" + Date.now();
  }

  function normalizeStoryId(story){
    if(story.id) return story.id;
    if(story.firebaseId) return story.firebaseId;
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

  function normalizeTip(tip){
    return {
      id: tip.id || "",
      title: tip.title || "",
      place: tip.place || "",
      text: tip.text || "",
      image: tip.image || "",
      name: tip.name || "",
      contact: tip.contact || "",
      createdAt: tip.createdAt || ""
    };
  }

  function normalizePartner(partner){
    return {
      id: partner.id || partner.firebaseId || makeId("partner"),
      firebaseId: partner.firebaseId || partner.id || "",
      navn: partner.navn || "Lokal partner",
      logoTekst: partner.logoTekst || "LOGO",
      logoUrl: partner.logoUrl || "",
      tekst: partner.tekst || "",
      url: partner.url || "",
      niva: partner.niva || "partner",
      size: partner.size || "small",
      start: partner.start || "",
      slutt: partner.slutt || "",
      aktiv: partner.aktiv !== false
    };
  }


  function normalizeSource(source){
    return {
      id: source.id || source.firebaseId || makeId("source"),
      firebaseId: source.firebaseId || source.id || "",
      name: source.name || "Uten navn",
      kind: source.kind || "URL",
      link: source.link || "",
      instruction: source.instruction || "",
      frequency: source.frequency || "Daglig",
      active: source.active !== false,
      lastHash: source.lastHash || "",
      lastChecked: source.lastChecked || "",
      lastResult: source.lastResult || "",
      lastDraftId: source.lastDraftId || ""
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

  function storyFromTip(tip){
    const t = normalizeTip(tip);

    const textParts = [];

    if(t.text) textParts.push(t.text);
    if(t.place) textParts.push(`\nSted: ${t.place}`);
    if(t.name || t.contact) textParts.push(`\nTipskontakt: ${[t.name, t.contact].filter(Boolean).join(" · ")}`);

    return normalizeStory({
      id: makeId("sak"),
      kategori: "Tips",
      tittel: t.title || "Tips fra leser",
      ingress: t.place ? `Tips fra ${t.place}` : "Tips sendt inn fra leser.",
      tekst: textParts.join("\n"),
      bildeUrl: t.image || "",
      videoUrl: "",
      mediaPlassering: "top",
      kilde: "Tips fra leser",
      sourceUrl: "",
      status: "til_godkjenning",
      dato: nowIso(),
      tid: nowTime(),
      hovedsak: false,
      originalTipId: t.id
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
    const id = cleanStory.id;

    await setDoc(doc(db, COLLECTIONS.saker, id), {
      ...cleanStory,
      status: cleanStory.status || "publisert",
      oppdatertAt: serverTimestamp()
    }, { merge: true });
  }

  async function saveDraftToFirebase(story){
    const cleanStory = normalizeStory(story);

    await setDoc(doc(db, COLLECTIONS.saker, cleanStory.id), {
      ...cleanStory,
      status: "til_godkjenning",
      oppdatertAt: serverTimestamp()
    }, { merge: true });
  }


  async function deleteDraftFromFirebase(story){
    const cleanStory = normalizeStory(story);
    const id = cleanStory.id || cleanStory.firebaseId;

    if(!id) return;

    await deleteDoc(doc(db, COLLECTIONS.saker, id));
  }

  async function deleteStoryFromFirebase(story){
    const cleanStory = normalizeStory(story);
    const id = cleanStory.id || cleanStory.firebaseId;

    if(!id) return;

    await deleteDoc(doc(db, COLLECTIONS.saker, id));
  }

  async function savePartnerToFirebase(partner){
    const cleanPartner = normalizePartner(partner);

    await setDoc(doc(db, COLLECTIONS.partnere, cleanPartner.id), {
      ...cleanPartner,
      oppdatertAt: serverTimestamp()
    }, { merge: true });
  }

  async function deletePartnerFromFirebase(partner){
    const p = normalizePartner(partner);
    const id = p.id || p.firebaseId;

    if(!id) return;

    await deleteDoc(doc(db, COLLECTIONS.partnere, id));
  }


  async function saveSourceToFirebase(source){
    const cleanSource = normalizeSource(source);

    await setDoc(doc(db, COLLECTIONS.kilder, cleanSource.id), {
      ...cleanSource,
      oppdatertAt: serverTimestamp()
    }, { merge: true });
  }

  async function deleteSourceFromFirebase(source){
    const s = normalizeSource(source);
    const id = s.id || s.firebaseId;

    if(!id) return;

    await deleteDoc(doc(db, COLLECTIONS.kilder, id));
  }

  async function deleteTip(tipId){
    await deleteDoc(doc(db, COLLECTIONS.tips, tipId));
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
            <button type="button" class="danger" data-delete-published="${i}">Slett helt</button>
          </div>
        `;
        $("publishedList").appendChild(item);
      });

      document.querySelectorAll("[data-unpublish]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();

          const index = Number(btn.dataset.unpublish);
          const story = normalizeStory(published[index]);

          story.status = "til_godkjenning";
          drafts.unshift(story);

          try{
            await saveDraftToFirebase(story);
            await deleteStoryFromFirebase(story);
          }catch(err){
            console.error("Firebase-feil:", err);
          }

          renderAll();
          switchTab("godkjenning");
        });
      });

      document.querySelectorAll("[data-delete-published]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();

          if(!confirm("Slette publisert sak helt?")) return;

          const index = Number(btn.dataset.deletePublished);
          const story = published[index];

          try{
            await deleteStoryFromFirebase(story);
            published.splice(index, 1);
            renderAll();
          }catch(err){
            console.error("Kunne ikke slette publisert sak:", err);
          }
        });
      });
    }

    if(exists("tipsList")){
      $("tipsList").innerHTML = tips.length ? "" : `<div class="previewEmpty">Ingen tips sendt inn ennå.</div>`;

      tips.forEach((rawTip) => {
        const tip = normalizeTip(rawTip);
        const item = document.createElement("div");
        const dato = formatDate(tip.createdAt);

        item.className = "listItem";
        item.innerHTML = `
          <small>Nytt tips${dato ? " · " + escapeText(dato) : ""}${tip.place ? " · " + escapeText(tip.place) : ""}</small>
          <h3>${escapeText(tip.title || "Tips uten tittel")}</h3>
          <p>${escapeText(tip.text)}</p>
          ${tip.image ? `<p><small>Bilde: ${escapeText(tip.image)}</small></p>` : ""}
          ${tip.name || tip.contact ? `<p><small>Kontakt: ${escapeText([tip.name, tip.contact].filter(Boolean).join(" · "))}</small></p>` : ""}
          <div class="itemActions">
            <button type="button" class="primary" data-tip-draft="${escapeText(tip.id)}">Lag kladd</button>
            <button type="button" class="danger" data-tip-delete="${escapeText(tip.id)}">Slett</button>
          </div>
        `;

        $("tipsList").appendChild(item);
      });

      document.querySelectorAll("[data-tip-draft]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();

          const tipId = btn.dataset.tipDraft;
          const tip = tips.find(t => t.id === tipId);
          if(!tip) return;

          const story = storyFromTip(tip);
          drafts.unshift(story);

          try{
            await saveDraftToFirebase(story);
            await deleteTip(tipId);
          }catch(err){
            console.error("Kunne ikke lage kladd fra tips:", err);
          }

          renderAll();
          switchTab("godkjenning");
        });
      });

      document.querySelectorAll("[data-tip-delete]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();

          if(!confirm("Slette tipset?")) return;

          try{
            await deleteTip(btn.dataset.tipDelete);
          }catch(err){
            console.error("Kunne ikke slette tips:", err);
          }
        });
      });
    }

    if(exists("partnerList")){
      $("partnerList").innerHTML = partners.length ? "" : `<div class="previewEmpty">Ingen partnere lagt inn.</div>`;

      partners.forEach((rawPartner, i) => {
        const p = normalizePartner(rawPartner);
        const item = document.createElement("div");
        item.className = "listItem";
        item.innerHTML = `
          <small>${escapeText(p.niva)} · ${escapeText(p.size)} · ${escapeText(p.start || "")} – ${escapeText(p.slutt || "")}</small>
          <h3>${escapeText(p.navn)}</h3>
          <p>${escapeText(p.tekst)}</p>
          <div class="itemActions">
            <button type="button" class="danger" data-delete-partner="${i}">Slett partner</button>
          </div>
        `;

        $("partnerList").appendChild(item);
      });

      document.querySelectorAll("[data-delete-partner]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();

          if(!confirm("Slette partner?")) return;

          const index = Number(btn.dataset.deletePartner);
          const partner = partners[index];

          try{
            await deletePartnerFromFirebase(partner);
            partners.splice(index, 1);
            renderAll();
          }catch(err){
            console.error("Kunne ikke slette partner:", err);
          }
        });
      });
    }

    if(exists("sourceList")){
      $("sourceList").innerHTML = sources.length ? "" : `<div class="previewEmpty">Ingen kilder lagt inn.</div>`;

      sources.forEach((rawSource, i) => {
        const s = normalizeSource(rawSource);
        const item = document.createElement("div");
        const statusClass = s.lastChecked ? "ok" : "wait";
        const statusText = s.lastChecked
          ? `Sist sjekket: ${escapeText(formatDate(s.lastChecked))}`
          : "Venter på første sjekk";

        item.className = "listItem";
        item.innerHTML = `
          <small>${escapeText(s.kind)} · ${escapeText(s.frequency)} · ${s.active ? "Aktiv" : "Pause"}</small>
          <h3>${escapeText(s.name)}</h3>
          <p>${escapeText(s.link)}</p>
          <p>${escapeText(s.instruction)}</p>
          <div class="sourceStatus ${statusClass}">${statusText}</div>
          ${s.lastResult ? `<p><small>${escapeText(s.lastResult)}</small></p>` : ""}
          <div class="itemActions">
            <button type="button" class="warn" data-delete-source="${i}">Fjern kilde</button>
          </div>
        `;
        $("sourceList").appendChild(item);
      });

      document.querySelectorAll("[data-delete-source]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();

          if(!confirm("Fjerne kilden fra kildevakten?")) return;

          const index = Number(btn.dataset.deleteSource);
          const source = sources[index];

          try{
            await deleteSourceFromFirebase(source);
            sources.splice(index, 1);
            renderAll();
          }catch(err){
            console.error("Kunne ikke fjerne kilde:", err);
          }
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
      $("status").textContent = `${drafts.length} til godkjenning · ${published.length} publisert · ${tips.length} tips · ${partners.length} partnere · ${sources.length} kilder`;
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


  function setStatus(text){
    if(exists("status")) $("status").textContent = text;
  }

  function aiDraftUrl(){
    const local = location.hostname === "127.0.0.1" || location.hostname === "localhost";
    return local
      ? "http://localhost:8888/.netlify/functions/ai-draft"
      : "/.netlify/functions/ai-draft";
  }


  function sourceWatchUrl(){
    const local = location.hostname === "127.0.0.1" || location.hostname === "localhost";
    return local
      ? "http://localhost:8888/.netlify/functions/source-watch"
      : "/.netlify/functions/source-watch";
  }

  async function runSourceWatchNow(){
    const btn = $("runSourceWatch");
    const oldText = btn ? btn.textContent : "";

    try{
      if(btn){
        btn.disabled = true;
        btn.textContent = "Sjekker kilder...";
      }

      setStatus("Kildevakten sjekker kilder...");

      const res = await fetch(sourceWatchUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual: true })
      });

      const data = await res.json();

      if(!res.ok || data.ok === false){
        throw new Error(data.error || "Kildevakten feilet");
      }

      const draftCount = await refreshDraftsFromFirebase();

      setStatus(`Kildevakt ferdig · ${data.draftsCreated || 0} kladder laget · ${draftCount} i listen`);

      if((data.draftsCreated || 0) > 0 || draftCount > 0){
        switchTab("godkjenning");
      }

      alert(`Kildevakt ferdig.\nKladder laget: ${data.draftsCreated || 0}\nKladder i listen: ${draftCount}`);
    }catch(err){
      console.error("Kildevakt feilet:", err);
      alert("Kildevakten feilet. Sjekk Netlify Functions og OPENAI_API_KEY.");
      setStatus("Kildevakt feilet");
    }finally{
      if(btn){
        btn.disabled = false;
        btn.textContent = oldText || "Kjør kildevakt nå";
      }
    }
  }

  function localAiFallbackDraft(payload){
    const raw = (payload.rawInput || payload.tekst || payload.ingress || "").trim();
    const clean = raw.replace(/\s+/g, " ").trim();
    const kategori = payload.kategori || "Lokalt";
    const title = payload.tittel || (
      kategori === "Politilogg" ? "Hendelse i Øst politidistrikt" :
      kategori === "Kommune" ? "Kommunal sak kort forklart" :
      kategori === "Arrangement" ? "Dette skjer i Halden" :
      "Ny lokal sak"
    );

    const ingress = payload.ingress || (
      clean ? clean.slice(0, 130) + (clean.length > 130 ? "..." : "") : "Kort forklart sak for Halden NÅ."
    );

    const tekst = clean
      ? `${ingress}\n\nKort forklart:\n${clean}\n\nDette er et AI-utkast som må kontrolleres før publisering.`
      : "Skriv eller lim inn råstoff først. AI-utkastet må kontrolleres før publisering.";

    return {
      kategori,
      tittel: title,
      ingress,
      tekst,
      bildeUrl: payload.bildeUrl || "",
      videoUrl: payload.videoUrl || "",
      mediaPlassering: payload.mediaPlassering || "top",
      kilde: payload.kilde || "Manuelt råstoff",
      sourceUrl: payload.sourceUrl || "",
      hovedsak: false
    };
  }

  function fillNewStoryFormFromAi(draft){
    if(exists("sourceType") && draft.kategori) $("sourceType").value = draft.kategori;
    if(exists("newTitle")) $("newTitle").value = draft.tittel || "";
    if(exists("newIngress")) $("newIngress").value = draft.ingress || "";
    if(exists("newText")) $("newText").value = draft.tekst || "";
    if(exists("rawImage")) $("rawImage").value = draft.bildeUrl || "";
    if(exists("rawVideo")) $("rawVideo").value = draft.videoUrl || "";
    if(exists("mediaPlacement")) $("mediaPlacement").value = draft.mediaPlassering || "top";
    if(exists("customSourceType")) $("customSourceType").value = draft.kilde || "";
    if(exists("sourceUrl")) $("sourceUrl").value = draft.sourceUrl || "";
    if(exists("mainStory")) $("mainStory").checked = draft.hovedsak === true;

    renderPreview("draftPreview", readNewStoryForm());
  }

  async function lagAiForslag(){
    const payload = readNewStoryForm();

    if(!payload.tittel && !payload.ingress && !payload.tekst && !payload.rawInput){
      alert("Lim inn råstoff eller skriv litt tekst først.");
      return;
    }

    const btn = $("makeAiDraft");
    const oldText = btn ? btn.textContent : "";

    try{
      if(btn){
        btn.disabled = true;
        btn.textContent = "Lager forslag...";
      }

      setStatus("AI lager forslag...");

      const res = await fetch(aiDraftUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if(!res.ok) throw new Error(`AI svarte ${res.status}`);

      const data = await res.json();

      if(!data.ok || !data.draft){
        throw new Error(data.error || "AI ga ikke forslag");
      }

      fillNewStoryFormFromAi(data.draft);
      setStatus(data.fallback ? "Lokalt forslag klart" : "AI-forslag klart");
    }catch(err){
      console.log("AI-forslag feilet, bruker lokal mal:", err);
      fillNewStoryFormFromAi(localAiFallbackDraft(payload));
      setStatus("Lokalt forslag klart");
    }finally{
      if(btn){
        btn.disabled = false;
        btn.textContent = oldText || "Lag AI-forslag";
      }
    }
  }


  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      switchTab(tab.dataset.tab);

      if(tab.dataset.tab === "godkjenning"){
        await refreshDraftsFromFirebase();
      }
    });
  });

  if(exists("makeAiDraft")){
    $("makeAiDraft").addEventListener("click", lagAiForslag);
  }

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

      const existingIndex = published.findIndex(s => normalizeStory(s).id === story.id);

      if(existingIndex >= 0){
        published[existingIndex] = story;
      }else{
        published.unshift(story);
      }

      drafts.splice(activeDraftIndex, 1);
      activeDraftIndex = null;

      try{
        await saveStoryToFirebase(story);
        await deleteDraftFromFirebase(story);
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
    $("deleteDraft").addEventListener("click", async () => {
      if(activeDraftIndex === null) return;

      if(confirm("Slette kladden?")){
        const story = drafts[activeDraftIndex];

        try{
          await deleteDraftFromFirebase(story);
        }catch(err){
          console.error("Kunne ikke slette kladd fra Firebase:", err);
        }

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
    $("addPartner").addEventListener("click", async () => {
      const partner = normalizePartner({
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

      partners.unshift(partner);

      try{
        await savePartnerToFirebase(partner);
      }catch(err){
        console.error("Kunne ikke lagre partner i Firebase:", err);
      }

      ["partnerName", "partnerLogoText", "partnerLogoUrl", "partnerText", "partnerUrl", "partnerStart", "partnerEnd"].forEach(id => {
        if(exists(id)) $(id).value = "";
      });

      renderAll();
    });
  }

  if(exists("addSource")){
    $("addSource").addEventListener("click", async () => {
      const source = normalizeSource({
        id: makeId("source"),
        name: value("sourceName", "Uten navn") || "Uten navn",
        kind: value("sourceKind", "URL"),
        link: value("sourceLink", ""),
        instruction: value("sourceInstruction", ""),
        frequency: value("sourceFrequency", "Daglig"),
        active: true
      });

      if(!source.link){
        alert("Legg inn URL / dokumentlenke først.");
        return;
      }

      sources.unshift(source);

      try{
        await saveSourceToFirebase(source);
      }catch(err){
        console.error("Kunne ikke lagre kilde i Firebase:", err);
      }

      ["sourceName", "sourceLink", "sourceInstruction"].forEach(id => {
        if(exists(id)) $(id).value = "";
      });

      renderAll();
    });
  }

  if(exists("runSourceWatch")){
    $("runSourceWatch").addEventListener("click", runSourceWatchNow);
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