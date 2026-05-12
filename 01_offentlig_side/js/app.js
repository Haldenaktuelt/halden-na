document.addEventListener("DOMContentLoaded", () => {

  const saker = window.HALDEN_NA_SAKER;

  if (!saker || saker.length === 0) {
    console.error("Ingen saker funnet.");
    return;
  }

  console.log("HALDEN NÅ saker lastet:", saker);

  function fyllHero(heroNummer, sakIndex) {
    const sak = saker[sakIndex];

    if (!sak) return;

    document.getElementById(`hero${heroNummer}-kicker`).textContent = sak.kategori;
    document.getElementById(`hero${heroNummer}-title`).textContent = sak.tittel;
    document.getElementById(`hero${heroNummer}-lead`).textContent = sak.ingress;

    document.getElementById(`hero${heroNummer}`).style.backgroundImage =
      `url('${sak.bilde}')`;
  }

  fyllHero(1, 0);
  fyllHero(2, 1);
  fyllHero(3, 2);

  const heroLinks = document.querySelectorAll("[data-sak-index]");

  heroLinks.forEach(hero => {
    hero.addEventListener("click", (e) => {
      e.preventDefault();

      const sakIndex = Number(hero.dataset.sakIndex);
      const sak = saker[sakIndex];

      if (!sak) return;

      document.getElementById("modal-kicker").textContent = sak.kategori;
      document.getElementById("modal-title").textContent = sak.tittel;
      document.getElementById("modal-text").textContent = sak.tekst;

      window.location.hash = "sak1";
    });
  });

});