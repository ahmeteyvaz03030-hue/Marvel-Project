// Auswählbare Benutzer-Avatare (stilisierte Icons statt echter Schauspielerfotos).
const AVATARS = {
  ahmet: {
    name: "Ahmet",
    hero: "Steve Rogers / Captain America",
    color: "#3b5bdb",
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="#a5121b"/>
      <circle cx="50" cy="50" r="37" fill="#eef0f4"/>
      <circle cx="50" cy="50" r="26" fill="#1b3d8f"/>
      <circle cx="50" cy="50" r="12" fill="#eef0f4"/>
      <polygon points="50,36 54,46 65,46 56,53 59,64 50,57 41,64 44,53 35,46 46,46" fill="#1b3d8f"/>
    </svg>`,
  },
  burak: {
    name: "Burak",
    hero: "Tony Stark / Iron Man",
    color: "#c9962f",
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M50 4C74 4 86 22 86 46 86 70 74 92 50 98 26 92 14 70 14 46 14 22 26 4 50 4Z" fill="#7a0f14"/>
      <path d="M50 10C70 10 78 26 78 46 78 66 68 86 50 92 32 86 22 66 22 46 22 26 30 10 50 10Z" fill="#c9962f"/>
      <path d="M50 16C66 16 72 30 72 46 72 62 64 80 50 86 36 80 28 62 28 46 28 30 34 16 50 16Z" fill="#a5121b"/>
      <path d="M34 42 46 40 46 48 36 50Z" fill="#eaffff"/>
      <path d="M66 42 54 40 54 48 64 50Z" fill="#eaffff"/>
      <rect x="46" y="55" width="8" height="24" rx="3" fill="#c9962f"/>
      <path d="M38 76Q50 87 62 76L62 82Q50 91 38 82Z" fill="#c9962f"/>
    </svg>`,
  },
};

// Alle MCU-Filme in chronologischer Erscheinungsreihenfolge, bis Avengers: Doomsday.
const MCU_TIMELINE = [
  {
    phase: "Phase 1",
    films: [
      { title: "Iron Man", year: 2008 },
      { title: "Der unglaubliche Hulk", year: 2008 },
      { title: "Iron Man 2", year: 2010 },
      { title: "Thor", year: 2011 },
      { title: "Captain America: The First Avenger", year: 2011 },
      { title: "The Avengers", year: 2012 },
    ],
  },
  {
    phase: "Phase 2",
    films: [
      { title: "Iron Man 3", year: 2013 },
      { title: "Thor: The Dark World", year: 2013 },
      { title: "Captain America: The Return of the First Avenger", year: 2014 },
      { title: "Guardians of the Galaxy", year: 2014 },
      { title: "Avengers: Age of Ultron", year: 2015 },
      { title: "Ant-Man", year: 2015 },
    ],
  },
  {
    phase: "Phase 3",
    films: [
      { title: "Captain America: Civil War", year: 2016 },
      { title: "Doctor Strange", year: 2016 },
      { title: "Guardians of the Galaxy Vol. 2", year: 2017 },
      { title: "Spider-Man: Homecoming", year: 2017 },
      { title: "Thor: Ragnarok", year: 2017 },
      { title: "Black Panther", year: 2018 },
      { title: "Avengers: Infinity War", year: 2018 },
      { title: "Ant-Man and the Wasp", year: 2018 },
      { title: "Captain Marvel", year: 2019 },
      { title: "Avengers: Endgame", year: 2019 },
      { title: "Spider-Man: Far From Home", year: 2019 },
    ],
  },
  {
    phase: "Phase 4",
    films: [
      { title: "Black Widow", year: 2021 },
      { title: "Shang-Chi and the Legend of the Ten Rings", year: 2021 },
      { title: "Eternals", year: 2021 },
      { title: "Spider-Man: No Way Home", year: 2021 },
      { title: "Doctor Strange in the Multiverse of Madness", year: 2022 },
      { title: "Thor: Love and Thunder", year: 2022 },
      { title: "Black Panther: Wakanda Forever", year: 2022 },
    ],
  },
  {
    phase: "Phase 5",
    films: [
      { title: "Ant-Man and the Wasp: Quantumania", year: 2023 },
      { title: "Guardians of the Galaxy Vol. 3", year: 2023 },
      { title: "The Marvels", year: 2023 },
      { title: "Deadpool & Wolverine", year: 2024 },
    ],
  },
  {
    phase: "Phase 6",
    films: [
      { title: "Captain America: Brave New World", year: 2025 },
      { title: "Thunderbolts*", year: 2025 },
      { title: "The Fantastic Four: First Steps", year: 2025 },
      { title: "Avengers: Doomsday", year: 2026, finale: true },
    ],
  },
];

// Datengrundlage für alle Marvel-Universen, die als Planeten dargestellt werden.
// Jeder Charakter trägt einen kurzen Steckbrief (bio) sowie seine Auftritte (films).
// Hinweis: Auf exakte Minutenangaben wird bewusst verzichtet, da sich diese nicht
// verlässlich belegen lassen — stattdessen gibt "note" die Art des Auftritts an
// (z.B. Hauptrolle, Cameo, stirbt im Finale).
const UNIVERSES = [
  {
    id: "tobey",
    name: "Sam Raimi Spider-Man",
    eyebrow: "Universum · Tobey Maguire",
    colorA: "#8b0f0f",
    colorB: "#173d8f",
    accent: "#ff4d4d",
    radius: 2.1,
    orbitRadius: 15,
    orbitSpeed: 0.055,
    startAngle: 0.2,
    yOffset: 0.5,
    desc: "Das Universum, das den modernen Superheldenfilm neu erfunden hat. Peter Parker balanciert zwischen Verantwortung und Verlust in New York City.",
    characters: [
      {
        name: "Peter Parker / Spider-Man",
        role: "Tobey Maguire",
        bio: "Ein schüchterner Highschool-Fotograf aus Queens, der nach dem Biss einer gentechnisch veränderten Spinne übermenschliche Kräfte erhält. Nach dem Tod seines Onkels Ben lernt er, dass mit großer Kraft große Verantwortung einhergeht, und wird zum Beschützer New Yorks.",
        films: [
          { title: "Spider-Man", year: 2002, note: "Hauptrolle" },
          { title: "Spider-Man 2", year: 2004, note: "Hauptrolle" },
          { title: "Spider-Man 3", year: 2007, note: "Hauptrolle" },
          { title: "Spider-Man: No Way Home", year: 2021, note: "Cameo im letzten Drittel" },
        ],
      },
      {
        name: "Mary Jane Watson",
        role: "Kirsten Dunst",
        bio: "Peters Nachbarin und große Liebe, eine angehende Schauspielerin, die zwischen ihren Gefühlen für Peter und Harry hin- und hergerissen ist und mehrfach von Spider-Man gerettet werden muss.",
        films: [
          { title: "Spider-Man", year: 2002, note: "Hauptrolle" },
          { title: "Spider-Man 2", year: 2004, note: "Hauptrolle" },
          { title: "Spider-Man 3", year: 2007, note: "Hauptrolle" },
        ],
      },
      {
        name: "Harry Osborn / New Goblin",
        role: "James Franco",
        bio: "Peters bester Freund und Sohn von Norman Osborn. Nach dem Tod seines Vaters übernimmt er dessen Erbe als Goblin und wird zunächst Spider-Mans Feind, bevor er sich am Ende opfert, um seinen Freund zu retten.",
        films: [
          { title: "Spider-Man", year: 2002, note: "Nebenrolle" },
          { title: "Spider-Man 2", year: 2004, note: "entdeckt gegen Filmende Spider-Mans Identität" },
          { title: "Spider-Man 3", year: 2007, note: "zentrale Rolle als New Goblin, stirbt im Finale" },
        ],
      },
      {
        name: "Norman Osborn / Green Goblin",
        role: "Willem Dafoe",
        bio: "Erfolgreicher Wissenschaftler und Industrieller, der durch ein fehlgeschlagenes Selbstexperiment mit dem Green-Goblin-Serum wahnsinnig wird und zum ersten großen Widersacher Spider-Mans wird.",
        films: [
          { title: "Spider-Man", year: 2002, note: "Hauptantagonist, stirbt im Finale" },
          { title: "Spider-Man 3", year: 2007, note: "Erscheint als Erinnerung/Geist, die Harry berät" },
        ],
      },
      {
        name: "Otto Octavius / Doc Ock",
        role: "Alfred Molina",
        bio: "Brillanter Fusionsforscher, dessen mechanische Roboterarme sich nach einem Laborunfall mit seinem Nervensystem verschmelzen und ihn zu Doctor Octopus machen.",
        films: [{ title: "Spider-Man 2", year: 2004, note: "Hauptantagonist des gesamten Films" }],
      },
      {
        name: "Eddie Brock / Venom",
        role: "Topher Grace",
        bio: "Ehrgeiziger Fotograf-Rivale Peters, der sich mit dem außerirdischen Symbionten verbindet, nachdem Peter ihn hat auffliegen lassen, und als Venom Rache sucht.",
        films: [{ title: "Spider-Man 3", year: 2007, note: "Tritt in der zweiten Filmhälfte auf, Antagonist im Finale" }],
      },
      {
        name: "Flint Marko / Sandman",
        role: "Thomas Haden Church",
        bio: "Ein flüchtiger Krimineller, der nach einem Unfall in einem Partikelbeschleuniger die Fähigkeit erhält, seinen Körper in Sand zu verwandeln — und sich als der wahre Mörder von Peters Onkel Ben entpuppt.",
        films: [{ title: "Spider-Man 3", year: 2007, note: "Nebenhandlung von Beginn an, zentral im Finale" }],
      },
      {
        name: "Tante May",
        role: "Rosemary Harris",
        bio: "Peters liebevolle Tante, die ihn nach dem Tod seiner Eltern großzieht und ihm nach dem Verlust ihres Mannes Ben moralischen Halt gibt.",
        films: [
          { title: "Spider-Man", year: 2002, note: "Durchgehende Nebenrolle" },
          { title: "Spider-Man 2", year: 2004, note: "Durchgehende Nebenrolle" },
          { title: "Spider-Man 3", year: 2007, note: "Durchgehende Nebenrolle" },
        ],
      },
    ],
    movies: [
      { title: "Spider-Man", year: 2002 },
      { title: "Spider-Man 2", year: 2004 },
      { title: "Spider-Man 3", year: 2007 },
      { title: "Spider-Man: No Way Home (Cameo)", year: 2021 },
    ],
  },
  {
    id: "garfield",
    name: "The Amazing Spider-Man",
    eyebrow: "Universum · Andrew Garfield",
    colorA: "#a3121f",
    colorB: "#0e7c86",
    accent: "#38d4e0",
    radius: 1.9,
    orbitRadius: 21,
    orbitSpeed: 0.045,
    startAngle: 2.4,
    yOffset: -1.2,
    desc: "Ein grüblerischerer, wissenschaftlich getriebener Peter Parker erkundet das Verschwinden seiner Eltern und verliebt sich in Gwen Stacy — mit tragischen Folgen.",
    characters: [
      {
        name: "Peter Parker / Spider-Man",
        role: "Andrew Garfield",
        bio: "Ein wissenschaftlich begabter, introvertierter Teenager, der nach dem Verschwinden seiner Eltern bei Onkel Ben und Tante May aufwächst und nach einem Biss in Oscorps Laboren zu Spider-Man wird.",
        films: [
          { title: "The Amazing Spider-Man", year: 2012, note: "Hauptrolle" },
          { title: "The Amazing Spider-Man 2", year: 2014, note: "Hauptrolle" },
          { title: "Spider-Man: No Way Home", year: 2021, note: "Cameo im letzten Drittel" },
        ],
      },
      {
        name: "Gwen Stacy",
        role: "Emma Stone",
        bio: "Peters hochintelligente Mitschülerin und große Liebe, Tochter des Polizeichefs, die ihm bei seinen wissenschaftlichen Ermittlungen hilft — bis ihr tragischer Tod die Geschichte für immer prägt.",
        films: [
          { title: "The Amazing Spider-Man", year: 2012, note: "Hauptrolle" },
          { title: "The Amazing Spider-Man 2", year: 2014, note: "Hauptrolle bis zum tragischen Finale" },
        ],
      },
      {
        name: "Harry Osborn",
        role: "Dane DeHaan",
        bio: "Peters Jugendfreund und Erbe von Oscorp, der an einer tödlichen Erbkrankheit leidet und sich nach seiner Verwandlung in den Green Goblin gegen Spider-Man wendet.",
        films: [{ title: "The Amazing Spider-Man 2", year: 2014, note: "Zentrale Rolle, ab der Filmmitte als Green Goblin" }],
      },
      {
        name: "Curt Connors / The Lizard",
        role: "Rhys Ifans",
        bio: "Ein Wissenschaftler mit nur einem Arm, der an Regenerationsforschung arbeitet und sich nach einem Selbstversuch in die reptilienhafte Bestie The Lizard verwandelt.",
        films: [{ title: "The Amazing Spider-Man", year: 2012, note: "Hauptantagonist des Films" }],
      },
      {
        name: "Max Dillon / Electro",
        role: "Jamie Foxx",
        bio: "Ein übersehener Oscorp-Elektroingenieur, der nach einem Unfall mit Elektroaalen zu einem Wesen aus reiner Energie wird und in seiner Verzweiflung nach Anerkennung zum Bösewicht wird.",
        films: [{ title: "The Amazing Spider-Man 2", year: 2014, note: "Hauptantagonist, ab der ersten Filmhälfte" }],
      },
      {
        name: "Aleksei Sytsevich / Rhino",
        role: "Paul Giamatti",
        bio: "Ein russischer Krimineller, der in einem schweren, gepanzerten Kampfanzug als Rhino auftritt.",
        films: [{ title: "The Amazing Spider-Man 2", year: 2014, note: "Kurzer Auftritt zu Beginn und im Schlussteaser" }],
      },
      {
        name: "Captain George Stacy",
        role: "Denis Leary",
        bio: "Der New Yorker Polizeichef und Gwens Vater, der Spider-Man zunächst misstrauisch gegenübersteht, ihm aber im Sterben aufträgt, seine Tochter aus seinem gefährlichen Leben herauszuhalten.",
        films: [{ title: "The Amazing Spider-Man", year: 2012, note: "Durchgehende Nebenrolle, stirbt im Finale" }],
      },
      {
        name: "Tante May",
        role: "Sally Field",
        bio: "Peters Tante, die nach dem Tod ihres Mannes Ben allein für Peter sorgt und zunehmend ahnt, dass er ein Doppelleben führt.",
        films: [
          { title: "The Amazing Spider-Man", year: 2012, note: "Durchgehende Nebenrolle" },
          { title: "The Amazing Spider-Man 2", year: 2014, note: "Durchgehende Nebenrolle" },
        ],
      },
    ],
    movies: [
      { title: "The Amazing Spider-Man", year: 2012 },
      { title: "The Amazing Spider-Man 2", year: 2014 },
      { title: "Spider-Man: No Way Home (Cameo)", year: 2021 },
    ],
  },
  {
    id: "holland",
    name: "MCU Spider-Man",
    eyebrow: "Universum · Tom Holland",
    colorA: "#b3231d",
    colorB: "#c9a227",
    accent: "#ffce54",
    radius: 2.3,
    orbitRadius: 27,
    orbitSpeed: 0.038,
    startAngle: 4.1,
    yOffset: 1.0,
    desc: "Ein junger, technikbegeisterter Peter Parker wächst im Schatten von Iron Man auf und wird Teil des Marvel Cinematic Universe — bis die Multiversum-Grenzen einreißen.",
    characters: [
      {
        name: "Peter Parker / Spider-Man",
        role: "Tom Holland",
        bio: "Ein technikbegeisterter Highschool-Schüler aus Queens, der von Tony Stark entdeckt und gefördert wird und zwischen Schulalltag und Superheldenleben balanciert, bevor seine Identität öffentlich wird.",
        films: [
          { title: "Captain America: Civil War", year: 2016, note: "Kurzer, entscheidender Auftritt im Flughafen-Showdown" },
          { title: "Spider-Man: Homecoming", year: 2017, note: "Hauptrolle" },
          { title: "Avengers: Infinity War", year: 2018, note: "stirbt im Finale (Blip)" },
          { title: "Avengers: Endgame", year: 2019, note: "kehrt zurück, kämpft in der finalen Schlacht" },
          { title: "Spider-Man: Far From Home", year: 2019, note: "Hauptrolle" },
          { title: "Spider-Man: No Way Home", year: 2021, note: "Hauptrolle" },
        ],
      },
      {
        name: "MJ (Michelle Jones)",
        role: "Zendaya",
        bio: "Peters schlagfertige, unabhängige Mitschülerin, die im Laufe der Filme seine engste Vertraute und Freundin wird.",
        films: [
          { title: "Spider-Man: Homecoming", year: 2017, note: "Kleine Nebenrolle" },
          { title: "Spider-Man: Far From Home", year: 2019, note: "Wachsende Nähe zu Peter" },
          { title: "Spider-Man: No Way Home", year: 2021, note: "Hauptrolle" },
        ],
      },
      {
        name: "Ned Leeds",
        role: "Jacob Batalon",
        bio: "Peters bester Freund, der als Erster sein Geheimnis entdeckt und ihm fortan als treuer Kumpel bei technischen Problemen zur Seite steht.",
        films: [
          { title: "Spider-Man: Homecoming", year: 2017, note: "Durchgehende Nebenrolle" },
          { title: "Spider-Man: Far From Home", year: 2019, note: "Durchgehende Nebenrolle" },
          { title: "Spider-Man: No Way Home", year: 2021, note: "Durchgehende Nebenrolle" },
        ],
      },
      {
        name: "Tony Stark / Iron Man",
        role: "Robert Downey Jr.",
        bio: "Genialer Erfinder und Milliardär, der Peter als Mentor unter seine Fittiche nimmt, ihm den Iron-Spider-Anzug baut und ihm väterliche Verantwortung beibringt.",
        films: [
          { title: "Captain America: Civil War", year: 2016, note: "Rekrutiert Peter" },
          { title: "Spider-Man: Homecoming", year: 2017, note: "Mentor-Rolle in mehreren Szenen" },
          { title: "Avengers: Infinity War", year: 2018, note: "Kämpft mit Peter auf Titan" },
          { title: "Avengers: Endgame", year: 2019, note: "Zentrale Rolle, opfert sich im Finale" },
        ],
      },
      {
        name: "Happy Hogan",
        role: "Jon Favreau",
        bio: "Tonys treuer Leibwächter und Fahrer, der nach Tonys Tod eine Art Ersatz-Vaterfigur für Peter und Vertrauter von Tante May wird.",
        films: [
          { title: "Spider-Man: Homecoming", year: 2017, note: "Durchgehende Nebenrolle" },
          { title: "Spider-Man: Far From Home", year: 2019, note: "Durchgehende Nebenrolle" },
        ],
      },
      {
        name: "Tante May",
        role: "Marisa Tomei",
        bio: "Peters Tante, die ihn großzieht, gegen Ende von Far From Home sein Geheimnis erfährt und ihn danach tatkräftig unterstützt.",
        films: [
          { title: "Captain America: Civil War", year: 2016, note: "Kurzer Auftritt" },
          { title: "Spider-Man: Homecoming", year: 2017, note: "Durchgehende Nebenrolle" },
          { title: "Spider-Man: Far From Home", year: 2019, note: "Erfährt Peters Geheimnis" },
          { title: "Spider-Man: No Way Home", year: 2021, note: "stirbt gegen Ende des Films" },
        ],
      },
      {
        name: "Quentin Beck / Mysterio",
        role: "Jake Gyllenhaal",
        bio: "Ein ehemaliger Stark-Industries-Mitarbeiter, der sich als Held aus einem Paralleluniversum ausgibt, um Peters Vertrauen zu gewinnen und ihn zu manipulieren.",
        films: [{ title: "Spider-Man: Far From Home", year: 2019, note: "Hauptantagonist, entlarvt sich in der zweiten Hälfte" }],
      },
      {
        name: "Adrian Toomes / Vulture",
        role: "Michael Keaton",
        bio: "Ein Bauunternehmer, dessen Firma von Stark-Aufräumarbeiten verdrängt wird und der daraufhin mit gestohlener Alien-Technologie als Vulture kriminell wird.",
        films: [{ title: "Spider-Man: Homecoming", year: 2017, note: "Hauptantagonist des gesamten Films" }],
      },
      {
        name: "Doctor Strange",
        role: "Benedict Cumberbatch",
        bio: "Meister der Mystic Arts, der Peter in No Way Home mit einem Multiversum-Zauber helfen will, der dann außer Kontrolle gerät.",
        films: [
          { title: "Spider-Man: Far From Home", year: 2019, note: "Kurze Erwähnung (sein Anzug wird ausgeliehen)" },
          { title: "Spider-Man: No Way Home", year: 2021, note: "Zentrale Rolle über den gesamten Film" },
        ],
      },
    ],
    movies: [
      { title: "Captain America: Civil War", year: 2016 },
      { title: "Spider-Man: Homecoming", year: 2017 },
      { title: "Avengers: Infinity War", year: 2018 },
      { title: "Avengers: Endgame", year: 2019 },
      { title: "Spider-Man: Far From Home", year: 2019 },
      { title: "Spider-Man: No Way Home", year: 2021 },
    ],
  },
  {
    id: "fantasticfour",
    name: "Fantastic Four",
    eyebrow: "Universum · Erste Familie Marvels",
    colorA: "#1b3a8a",
    colorB: "#c7d2dd",
    accent: "#7fb3ff",
    radius: 2.4,
    orbitRadius: 33,
    orbitSpeed: 0.03,
    startAngle: 1.1,
    yOffset: -0.6,
    desc: "Vier Astronauten werden durch kosmische Strahlung verändert und müssen als Familie zusammenhalten — gegen Bedrohungen, die ganze Realitäten umformen können.",
    characters: [
      {
        name: "Reed Richards / Mister Fantastic",
        role: "Pedro Pascal",
        bio: "Brillanter Wissenschaftler und Anführer der Fantastic Four, dessen Körper nach einem kosmischen Strahlungsunfall gummiartig dehnbar wird.",
        films: [{ title: "The Fantastic Four: First Steps", year: 2025, note: "Hauptrolle" }],
      },
      {
        name: "Sue Storm / Invisible Woman",
        role: "Vanessa Kirby",
        bio: "Reeds Partnerin, die sich und Objekte unsichtbar machen sowie Kraftfelder erzeugen kann, und als moralischer Anker des Teams gilt.",
        films: [{ title: "The Fantastic Four: First Steps", year: 2025, note: "Hauptrolle" }],
      },
      {
        name: "Johnny Storm / Human Torch",
        role: "Joseph Quinn",
        bio: "Sues impulsiver jüngerer Bruder, der seinen Körper vollständig in Flammen hüllen und fliegen kann.",
        films: [{ title: "The Fantastic Four: First Steps", year: 2025, note: "Hauptrolle" }],
      },
      {
        name: "Ben Grimm / The Thing",
        role: "Ebon Moss-Bachrach",
        bio: "Reeds bester Freund, dessen Haut sich nach dem Unfall in gesteinsartige, überstarke Materie verwandelt hat.",
        films: [{ title: "The Fantastic Four: First Steps", year: 2025, note: "Hauptrolle" }],
      },
      {
        name: "Victor von Doom / Doctor Doom",
        role: "Robert Downey Jr.",
        bio: "Herrscher von Latveria und einer der mächtigsten Menschen im Marvel-Multiversum, dessen Zusammenstoß mit den Fantastic Four ihn direkt auf Kollisionskurs mit den Avengers bringt.",
        films: [
          { title: "The Fantastic Four: First Steps", year: 2025, note: "Hauptantagonist" },
          { title: "Avengers: Doomsday", year: 2026, note: "Zentraler Antagonist der Multiversum-Konvergenz" },
        ],
      },
      {
        name: "Silver Surfer",
        role: "Julia Garner",
        bio: "Der silberne Herold eines kosmischen Weltenfressers, der der Erde als Vorbote einer bevorstehenden Zerstörung erscheint.",
        films: [{ title: "The Fantastic Four: First Steps", year: 2025, note: "Taucht in der ersten Filmhälfte als Bedrohung auf" }],
      },
    ],
    movies: [
      { title: "Fantastic Four", year: 2005 },
      { title: "Fantastic Four: Rise of the Silver Surfer", year: 2007 },
      { title: "Fantastic Four", year: 2015 },
      { title: "The Fantastic Four: First Steps", year: 2025 },
    ],
  },
  {
    id: "thunderbolts",
    name: "Thunderbolts",
    eyebrow: "Universum · Die neuen Avengers",
    colorA: "#3b1e5c",
    colorB: "#1c2230",
    accent: "#b48cff",
    radius: 1.8,
    orbitRadius: 39,
    orbitSpeed: 0.026,
    startAngle: 5.3,
    yOffset: 1.4,
    desc: "Eine Gruppe von Antihelden, Attentätern und gebrochenen Agenten wird zwangsweise zu einem Team — und findet sich als neue Avengers wieder.",
    characters: [
      {
        name: "Yelena Belova",
        role: "Florence Pugh",
        bio: "Eine in Russland ausgebildete Attentäterin und \"Schwester\" von Natasha Romanoff, die nach deren Tod als zynische, aber loyale Söldnerin auftritt und schließlich die Thunderbolts anführt.",
        films: [
          { title: "Black Widow", year: 2021, note: "Hauptrolle" },
          { title: "Thunderbolts*", year: 2025, note: "Hauptrolle" },
        ],
      },
      {
        name: "Bucky Barnes / Winter Soldier",
        role: "Sebastian Stan",
        bio: "Steve Rogers' Jugendfreund, der jahrzehntelang als gehirngewaschener Sowjet-Attentäter missbraucht wurde und inzwischen als US-Kongressabgeordneter versucht, seine Vergangenheit wiedergutzumachen.",
        films: [{ title: "Thunderbolts*", year: 2025, note: "Hauptrolle" }],
      },
      {
        name: "Alexei Shostakov / Red Guardian",
        role: "David Harbour",
        bio: "Die sowjetische Antwort auf Captain America — ein tollpatschiger, aber gutherziger Ex-Superheld und Yelenas Ziehvater.",
        films: [
          { title: "Black Widow", year: 2021, note: "Nebenrolle" },
          { title: "Thunderbolts*", year: 2025, note: "Nebenrolle" },
        ],
      },
      {
        name: "Ava Starr / Ghost",
        role: "Hannah John-Kamen",
        bio: "Eine Frau, deren Molekularinstabilität ihr erlaubt, durch Wände zu phasen, was ihr aber quälende Schmerzen bereitet.",
        films: [
          { title: "Ant-Man and the Wasp", year: 2018, note: "Hauptantagonistin" },
          { title: "Thunderbolts*", year: 2025, note: "Teammitglied" },
        ],
      },
      {
        name: "John Walker / U.S. Agent",
        role: "Wyatt Russell",
        bio: "Der offizielle, vom Staat ernannte Nachfolger als Captain America, der nach seinem Fall von Gnaden zum knallharten Söldner wird.",
        films: [{ title: "Thunderbolts*", year: 2025, note: "Hauptrolle" }],
      },
      {
        name: "Antonia Dreykov / Taskmaster",
        role: "Olga Kurylenko",
        bio: "Eine durch Konditionierung zur perfekten Kampfmaschine gemachte Attentäterin, die jede beobachtete Kampftechnik exakt kopieren kann.",
        films: [
          { title: "Black Widow", year: 2021, note: "Hauptantagonistin" },
          { title: "Thunderbolts*", year: 2025, note: "Teammitglied" },
        ],
      },
      {
        name: "Valentina Allegra de Fontaine",
        role: "Julia Louis-Dreyfus",
        bio: "Eine skrupellose Geheimdienst-Chefin, die die Thunderbolts als ihre eigene Privatarmee für schmutzige Missionen zusammenstellt.",
        films: [
          { title: "Black Widow", year: 2021, note: "Post-Credit-Auftritt" },
          { title: "Thunderbolts*", year: 2025, note: "Hauptrolle" },
        ],
      },
      {
        name: "Bob Reynolds / Sentry & The Void",
        role: "Lewis Pullman",
        bio: "Ein Mann mit der Kraft einer Million explodierender Sonnen, dessen Superkräfte von einer finsteren, selbstzerstörerischen Alter-Ego-Persönlichkeit namens The Void begleitet werden.",
        films: [{ title: "Thunderbolts*", year: 2025, note: "Zentrale Rolle, ab der Filmmitte als Sentry/Void enthüllt" }],
      },
    ],
    movies: [
      { title: "Black Widow (Ursprung)", year: 2021 },
      { title: "Thunderbolts*", year: 2025 },
    ],
  },
  {
    id: "xmen",
    name: "X-Men",
    eyebrow: "Universum · Mutanten",
    colorA: "#132a63",
    colorB: "#d4af37",
    accent: "#ffd75e",
    radius: 2.5,
    orbitRadius: 45,
    orbitSpeed: 0.022,
    startAngle: 3.3,
    yOffset: -1.5,
    desc: "Mutanten mit außergewöhnlichen Kräften kämpfen für ein friedliches Miteinander mit der Menschheit — angeführt von den gegensätzlichen Visionen von Xavier und Magneto.",
    characters: [
      {
        name: "Charles Xavier / Professor X",
        role: "Patrick Stewart",
        bio: "Der mächtigste Telepath der Welt und Gründer der Xavier-Schule, der von einer friedlichen Koexistenz zwischen Mutanten und Menschen träumt.",
        films: [
          { title: "X-Men", year: 2000, note: "Hauptrolle" },
          { title: "X2", year: 2003, note: "Hauptrolle" },
          { title: "X-Men: The Last Stand", year: 2006, note: "stirbt im Finale" },
          { title: "X-Men: Days of Future Past", year: 2014, note: "Junge Version, Nebenhandlung" },
        ],
      },
      {
        name: "Erik Lehnsherr / Magneto",
        role: "Ian McKellen",
        bio: "Ein Holocaust-Überlebender mit der Fähigkeit, Metall zu kontrollieren, der radikal für das Überleben der Mutanten kämpft — oft im Widerspruch zu seinem alten Freund Xavier.",
        films: [
          { title: "X-Men", year: 2000, note: "Hauptantagonist" },
          { title: "X2", year: 2003, note: "Zentrale Rolle" },
          { title: "X-Men: The Last Stand", year: 2006, note: "Hauptantagonist" },
          { title: "X-Men: Days of Future Past", year: 2014, note: "Zentrale Rolle in der Zukunftshandlung" },
        ],
      },
      {
        name: "Logan / Wolverine",
        role: "Hugh Jackman",
        bio: "Ein nahezu unsterblicher Mutant mit Selbstheilungskraft, ausfahrbaren Adamantium-Krallen und einem geheimnisvollen Gedächtnisverlust über seine Vergangenheit.",
        films: [
          { title: "X-Men", year: 2000, note: "Hauptrolle" },
          { title: "X2", year: 2003, note: "Hauptrolle" },
          { title: "X-Men: The Last Stand", year: 2006, note: "Hauptrolle" },
          { title: "X-Men Origins: Wolverine", year: 2009, note: "Hauptrolle" },
          { title: "The Wolverine", year: 2013, note: "Hauptrolle" },
          { title: "X-Men: Days of Future Past", year: 2014, note: "Hauptrolle, reist durch die Zeit" },
          { title: "Logan", year: 2017, note: "Hauptrolle, letzter Auftritt der Figur" },
        ],
      },
      {
        name: "Raven / Mystique",
        role: "Rebecca Romijn",
        bio: "Eine Gestaltwandlerin, die jede Person perfekt imitieren kann und lange Zeit loyal an Magnetos Seite kämpft.",
        films: [
          { title: "X-Men", year: 2000, note: "Nebenrolle" },
          { title: "X2", year: 2003, note: "Nebenrolle" },
          { title: "X-Men: The Last Stand", year: 2006, note: "Nebenrolle" },
        ],
      },
      {
        name: "Ororo Munroe / Storm",
        role: "Halle Berry",
        bio: "Eine Mutantin, die das Wetter beherrscht und zu einer der wichtigsten Lehrerinnen an Xaviers Schule wird.",
        films: [
          { title: "X-Men", year: 2000, note: "Nebenrolle" },
          { title: "X2", year: 2003, note: "Nebenrolle" },
          { title: "X-Men: The Last Stand", year: 2006, note: "Nebenrolle" },
          { title: "X-Men: Apocalypse", year: 2016, note: "Jüngere Version, Nebenrolle" },
        ],
      },
      {
        name: "Scott Summers / Cyclops",
        role: "James Marsden",
        bio: "Xaviers ältester Schüler, der ohne seine spezielle Rubin-Quarz-Visierbrille unkontrollierbare Energiestrahlen aus den Augen schießt.",
        films: [
          { title: "X-Men", year: 2000, note: "Nebenrolle" },
          { title: "X2", year: 2003, note: "Nebenrolle" },
          { title: "X-Men: The Last Stand", year: 2006, note: "stirbt zu Beginn des Films" },
        ],
      },
      {
        name: "Jean Grey / Phoenix",
        role: "Famke Janssen",
        bio: "Eine der mächtigsten Telepathinnen und Telekinetikerinnen überhaupt, deren unterdrückte \"Phoenix-Kraft\" sie in The Last Stand in eine zerstörerische Entität verwandelt.",
        films: [
          { title: "X-Men", year: 2000, note: "Nebenrolle" },
          { title: "X2", year: 2003, note: "opfert sich am Ende des Films" },
          { title: "X-Men: The Last Stand", year: 2006, note: "kehrt als Dark Phoenix zurück" },
        ],
      },
      {
        name: "Hank McCoy / Beast",
        role: "Nicholas Hoult",
        bio: "Ein brillanter Wissenschaftler und Mutant mit blauem Fell und tierischer Kraft und Beweglichkeit, der zwischen seiner menschlichen und mutierten Seite hin- und hergerissen ist.",
        films: [
          { title: "X-Men: First Class", year: 2011, note: "Hauptrolle" },
          { title: "X-Men: Days of Future Past", year: 2014, note: "Nebenrolle" },
          { title: "X-Men: Apocalypse", year: 2016, note: "Nebenrolle" },
          { title: "Dark Phoenix", year: 2019, note: "Nebenrolle" },
        ],
      },
      {
        name: "Wade Wilson / Deadpool",
        role: "Ryan Reynolds",
        bio: "Ein Söldner mit loser Zunge, der nach einem Selbstheilungsexperiment zum vierte-Wand-brechenden Antihelden Deadpool wird.",
        films: [
          { title: "X-Men Origins: Wolverine", year: 2009, note: "Kleine Nebenrolle" },
          { title: "Deadpool", year: 2016, note: "Hauptrolle" },
          { title: "Deadpool 2", year: 2018, note: "Hauptrolle" },
        ],
      },
    ],
    movies: [
      { title: "X-Men", year: 2000 },
      { title: "X2", year: 2003 },
      { title: "X-Men: The Last Stand", year: 2006 },
      { title: "X-Men Origins: Wolverine", year: 2009 },
      { title: "X-Men: First Class", year: 2011 },
      { title: "The Wolverine", year: 2013 },
      { title: "X-Men: Days of Future Past", year: 2014 },
      { title: "Deadpool", year: 2016 },
      { title: "X-Men: Apocalypse", year: 2016 },
      { title: "Logan", year: 2017 },
      { title: "Deadpool 2", year: 2018 },
      { title: "Dark Phoenix", year: 2019 },
      { title: "The New Mutants", year: 2020 },
    ],
  },
  {
    id: "doomsday",
    name: "Avengers: Doomsday",
    eyebrow: "Universum · Multiversum-Konvergenz",
    colorA: "#0d3320",
    colorB: "#7a4a12",
    accent: "#ff5a3c",
    radius: 3.1,
    orbitRadius: 12,
    orbitSpeed: 0,
    startAngle: -0.6,
    yOffset: 2.6,
    isDoomsday: true,
    releaseDate: "2026-12-18T00:00:00",
    desc: "Doctor Doom bricht in das Kernuniversum ein — und reißt die Grenzen zwischen den Welten der Avengers, X-Men und Fantastic Four endgültig ein. Der bislang größte Marvel-Crossover.",
    characters: [
      {
        name: "Victor von Doom / Doctor Doom",
        role: "Robert Downey Jr.",
        bio: "Herrscher von Latveria und einer der mächtigsten Menschen im Marvel-Multiversum. Nach seinem Aufeinandertreffen mit den Fantastic Four wird er zur zentralen Bedrohung für alle Universen gleichzeitig.",
        films: [
          { title: "The Fantastic Four: First Steps", year: 2025, note: "Erster Auftritt als Antagonist" },
          { title: "Avengers: Doomsday", year: 2026, note: "Hauptantagonist" },
        ],
      },
      {
        name: "Sam Wilson / Captain America",
        role: "Anthony Mackie",
        bio: "Ehemaliger Air-Force-Pararescue-Soldat und Falcon, der von Steve Rogers den Schild übernommen hat und nun als neuer Captain America die Erde gegen die größte Bedrohung ihrer Geschichte verteidigt.",
        films: [
          { title: "Captain America: Brave New World", year: 2025, note: "Hauptrolle" },
          { title: "Avengers: Doomsday", year: 2026, note: "Hauptrolle, führt die Allianz an" },
        ],
      },
      {
        name: "Charles Xavier / Professor X",
        role: "Patrick Stewart",
        bio: "Der mächtigste Telepath der Welt, der aus seinem eigenen Universum in die Doomsday-Konvergenz gezogen wird, um gemeinsam mit den Avengers gegen Doctor Doom zu bestehen.",
        films: [{ title: "Avengers: Doomsday", year: 2026, note: "Teil der Multiversum-Allianz" }],
      },
      {
        name: "Erik Lehnsherr / Magneto",
        role: "Ian McKellen",
        bio: "Der mächtige Metall-Manipulator aus dem X-Men-Universum, der trotz seiner Vergangenheit mit den Avengers gegen die gemeinsame Bedrohung antritt.",
        films: [{ title: "Avengers: Doomsday", year: 2026, note: "Teil der Multiversum-Allianz" }],
      },
      {
        name: "Ororo Munroe / Storm",
        role: "Halle Berry",
        bio: "Die wettersteuernde X-Men-Anführerin, die ihre Kräfte in der finalen Schlacht gegen Doctor Doom in die Waagschale wirft.",
        films: [{ title: "Avengers: Doomsday", year: 2026, note: "Teil der Multiversum-Allianz" }],
      },
      {
        name: "Reed Richards / Mister Fantastic",
        role: "Pedro Pascal",
        bio: "Der geniale Anführer der Fantastic Four, dessen wissenschaftliches Verständnis der Multiversum-Mechanik zum Schlüssel im Kampf gegen Doom werden könnte.",
        films: [
          { title: "The Fantastic Four: First Steps", year: 2025, note: "Hauptrolle" },
          { title: "Avengers: Doomsday", year: 2026, note: "Zentrale Rolle" },
        ],
      },
      {
        name: "Sue Storm / Invisible Woman",
        role: "Vanessa Kirby",
        bio: "Reeds Partnerin und moralischer Anker der Fantastic Four, die ihre Kraftfelder nun im größten Crossover der Filmreihe einsetzt.",
        films: [
          { title: "The Fantastic Four: First Steps", year: 2025, note: "Hauptrolle" },
          { title: "Avengers: Doomsday", year: 2026, note: "Zentrale Rolle" },
        ],
      },
      {
        name: "Bucky Barnes / Winter Soldier",
        role: "Sebastian Stan",
        bio: "Der ehemalige Winter Soldier und Thunderbolts-Kämpfer, der an der Seite von Sam Wilson erneut in die vorderste Front zieht.",
        films: [
          { title: "Thunderbolts*", year: 2025, note: "Hauptrolle" },
          { title: "Avengers: Doomsday", year: 2026, note: "Teil der Allianz" },
        ],
      },
      {
        name: "Yelena Belova",
        role: "Florence Pugh",
        bio: "Die scharfzüngige Anführerin der Thunderbolts, die mit ihrem Team der neuen, größten Bedrohung des Multiversums entgegentritt.",
        films: [
          { title: "Thunderbolts*", year: 2025, note: "Hauptrolle" },
          { title: "Avengers: Doomsday", year: 2026, note: "Teil der Allianz" },
        ],
      },
    ],
    movies: [{ title: "Avengers: Doomsday", year: 2026 }],
  },
];
