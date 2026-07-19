export const store = {
  defaults: {
    lang: "ar",
    theme: "classic",
    tab: "matches",
  },

  load() {
    try {
      const raw = localStorage.getItem("shaib_pwa_prefs");
      return { ...this.defaults, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      return { ...this.defaults };
    }
  },

  save(partial) {
    const next = { ...this.load(), ...partial };
    localStorage.setItem("shaib_pwa_prefs", JSON.stringify(next));
    return next;
  },
};
