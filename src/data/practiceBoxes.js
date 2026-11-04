const boxes = (source, category, platform, names) => names.map((name) => ({
  id: `${source}-${category}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name,
  source,
  category,
  platform,
  os: platform === "linux" ? "Linux" : "Windows",
  labType: source === "htb" ? "htb" : "oscp",
}));

export const PRACTICE_BOXES = [
  ...boxes("htb", "Linux", "linux", [
    "Busqueda", "UpDown", "Sau", "Help", "Broker", "Intentions", "Soccer", "Keeper", "Monitored", "BoardLight", "Networked", "CozyHosting", "Editorial", "Magic", "Pandora", "Builder", "LinkVortex", "Dog", "Markup", "Editor", "Usage", "Titanic", "Outbound (Assumed Breach)", "Expressway (Old System)", "Browsed",
  ]),
  ...boxes("htb", "Windows", "windows", [
    "Escape", "Servmon", "Support", "StreamIO", "Blackfield", "Intelligence", "Jeeves", "Manager", "Access", "Aero", "Mailing", "Administrator", "Certified", "Heist", "Tombwatcher (Assumed Breach)",
  ]),
  ...boxes("htb", "Active Directory", "ad", [
    "Active", "Forest", "Sauna", "Monteverde", "Timelapse", "Return", "Cascade", "Flight", "Blackfield", "Cicada", "Escape", "Adagio (Enterprise)", "TheFrizz", "Fluffy", "Puppy", "Voleur", "Signed (Assumed Breach)", "Eighteen (Assumed Breach)",
  ]),
  ...boxes("pg-practice", "Linux", "linux", [
    "Twiggy", "Exfiltrated", "Pelican", "Astronaut", "Blackgate", "Boolean", "Clue", "Cockpit", "Codo", "Crane", "Levram", "Extplorer", "Hub", "Image", "law", "Lavita", "PC", "Fired", "Press", "Scrutiny", "RubyDome", "Zipper", "Flu", "Workaholic", "PyLoader", "Plum", "SPX", "Jordak", "BitForge", "Vmdak", "Ochima", "Nibbles", "CVE-2023-6019", "Sea", "Payday", "Snookums", "SpiderSociety",
  ]),
  ...boxes("pg-practice", "Windows", "windows", [
    "Algernon", "Authby", "Craft", "Hutch", "Internal", "Jacko", "Kevin", "Resourced", "Squid", "DVR4", "Hepet", "Shenzi", "Nickel", "Slort", "MedJed", "Monster", "Mice",
  ]),
  ...boxes("pg-practice", "Active Directory", "ad", ["Access", "Heist", "Vault", "Nagoya", "Resourced", "Hutch"]),
  ...boxes("pg-play", "Linux", "linux", [
    "Election 1", "Stapler", "Monitoring", "InsanityHosting", "Vegeta 1", "SoSimple", "Gaara", "Amaterasu", "Blogger", "Potato", "DC-9", "Tre", "Seppuku", "Funbox", "Katana", "DriftingBlue6", "Loly", "BTRSys2.1",
  ]),
  ...boxes("pg-play", "Windows", "windows", ["Sams"]),
];

const SOURCE_LABELS = {
  htb: "Hack The Box",
  "pg-practice": "Proving Grounds Practice",
  "pg-play": "Proving Grounds Play",
};

export const PRACTICE_GROUPS = Object.entries(PRACTICE_BOXES.reduce((groups, box) => {
  const key = `${box.source}::${box.category}`;
  groups[key] = [...(groups[key] || []), box];
  return groups;
}, {})).map(([key, entries]) => {
  const [source, category] = key.split("::");
  return { key, label: `${SOURCE_LABELS[source]} — ${category}`, boxes: entries };
});

export const practiceBoxById = (id) => PRACTICE_BOXES.find((box) => box.id === id);

export const PLATFORM_PHASES = {
  linux: new Set(["setup", "recon", "services", "web", "access", "linux-privesc", "credentials", "pivoting", "proof"]),
  windows: new Set(["setup", "recon", "services", "web", "access", "windows-privesc", "credentials", "pivoting", "proof"]),
  ad: new Set(["setup", "recon", "services", "web", "access", "windows-privesc", "active-directory", "credentials", "pivoting", "proof"]),
};

export const platformLabel = (platform) => ({ linux: "Linux", windows: "Standalone Windows", ad: "Windows Active Directory" }[platform] || "Unknown / show all");
