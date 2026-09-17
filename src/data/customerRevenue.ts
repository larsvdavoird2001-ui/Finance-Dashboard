/**
 * AUTO-GENERATED door scripts/gen-customer-revenue.mjs — niet met de hand bewerken.
 * Omzet (gefactureerde nettowaarde) per entiteit × marktsegment × maand.
 * Bron: SAP-factuurvolume-uitdraai (CRMCIVIB_Q0001), laatste factuurdatum 2026-09-16.
 * Entiteit via projecteenheid, anders factuurnummer-prefix; marktsegment via Bedrijfstak,
 * aangevuld met de handmatige toewijzing in scripts/klant-toewijzing.json.
 * Uitgesloten: interne TPG-facturen, TPG Spanje en de KFT-reeks (holding/lease).
 */
export const MARKT_ENTITIES = ['Consultancy', 'Projects', 'Software'] as const
export const MARKT_SEGMENTS = ["1. Public","2. Telecom","3. Energy","4. Civil","5. Industry","6. Overig"] as const
export type MarktEntity = typeof MARKT_ENTITIES[number]
export type MarktSegment = typeof MARKT_SEGMENTS[number]

/** [jaar][entiteit][segment] = 12 maandbedragen (index 0 = januari). */
export const marktOmzet: Record<'2024' | '2025' | '2026', Record<MarktEntity, Record<MarktSegment, number[]>>> = {
  '2024': {
    Consultancy: {
      '1. Public': [23308,49305,54071,63595,169331,83389,55557,35138,54869,86248,96977,39207],
      '2. Telecom': [729542,1049485,966308,831477,837726,793009,756271,666234,662590,981528,803719,710800],
      '3. Energy': [131703,170707,141336,206455,213073,174993,129804,148524,136269,185439,230229,144961],
      '4. Civil': [38474,41000,36485,39613,35132,26526,42434,39780,31096,66424,43775,37280],
      '5. Industry': [137246,138466,124924,101823,92489,92290,88949,68384,54530,108488,78302,84016],
      '6. Overig': [0,161,0,0,16454,15322,385,12840,0,0,60640,24594],
    },
    Projects: {
      '1. Public': [23497,3882,6634,5451,2610,6685,4355,3977,10465,9854,8281,5562],
      '2. Telecom': [402342,383678,344196,356425,537734,406934,342598,408674,74630,440426,635972,224575],
      '3. Energy': [40995,43663,59154,78965,43978,52589,49990,50867,46572,108073,115098,51184],
      '4. Civil': [17889,161692,188633,32214,161019,105530,82789,107139,80226,109722,144094,96318],
      '5. Industry': [3540,3975,40699,63544,113,1790,1280,62437,27065,285,1118,2342],
      '6. Overig': [0,0,0,0,0,0,0,0,0,0,0,0],
    },
    Software: {
      '1. Public': [458561,172747,146467,188705,151300,103963,118341,145188,48553,124216,185188,452964],
      '2. Telecom': [88875,562,181137,562,5662,8878,3089,57612,7794,60272,242,563],
      '3. Energy': [194540,41467,89906,30218,91718,33845,58545,-3972,53913,96100,53326,112190],
      '4. Civil': [9872,4194,2664,2930,26388,24349,5783,4816,2339,1119,12952,5475],
      '5. Industry': [3400,14094,1120,-12583,4698,13005,287,6414,7360,13725,1403,637],
      '6. Overig': [0,0,0,0,0,0,0,0,0,0,0,0],
    },
  },
  '2025': {
    Consultancy: {
      '1. Public': [55771,39422,82799,49567,67165,65002,50936,55042,40428,37781,40781,45881],
      '2. Telecom': [650184,770140,846923,734834,850457,664330,668551,518368,711605,935663,573007,676289],
      '3. Energy': [116406,168083,92609,144601,84427,136428,93164,92035,91644,136431,117038,92155],
      '4. Civil': [47886,74741,72160,43240,80939,45102,50950,30719,49405,31177,25214,16760],
      '5. Industry': [76183,79925,82276,54536,64174,70468,63854,53228,69125,110444,99295,64426],
      '6. Overig': [0,26800,0,0,7415,1213,3566,263,941,1431,525,503],
    },
    Projects: {
      '1. Public': [1115,730,3091,2400,675,3403,135,573,1143,910,9147,6276],
      '2. Telecom': [283279,376438,495769,204226,278461,587219,331764,338870,318718,460896,372278,364661],
      '3. Energy': [46865,65250,113027,47024,125867,77748,84524,86647,99926,93260,107391,99881],
      '4. Civil': [122791,18948,107158,101497,205017,93781,101361,131074,82619,71222,80601,146929],
      '5. Industry': [1961,0,0,0,15297,24890,5921,5994,12344,26848,-4471,4640],
      '6. Overig': [0,0,0,0,0,20000,-10000,0,10000,125,0,0],
    },
    Software: {
      '1. Public': [338609,173251,133046,197811,48928,72195,150839,39829,127462,106445,329671,1032779],
      '2. Telecom': [84470,72094,1588,-17095,13740,7050,10180,26105,9999,2410,6764,54208],
      '3. Energy': [190769,105002,-19904,46371,48517,45197,74981,29603,39466,72993,34260,85438],
      '4. Civil': [16396,1582,3607,9666,8905,9262,1224,2011,20591,1062,44434,8382],
      '5. Industry': [982,12551,1061,16531,668,803,8586,4368,1493,6430,2008,1627],
      '6. Overig': [0,0,0,0,0,0,0,0,0,91,273,0],
    },
  },
  '2026': {
    Consultancy: {
      '1. Public': [22834,15057,6672,27781,17532,13302,16918,18551,0,0,0,0],
      '2. Telecom': [556579,610392,735925,810537,648721,587923,538990,435675,216180,0,0,0],
      '3. Energy': [82944,100855,234122,181526,163992,172159,195762,191483,92459,0,0,0],
      '4. Civil': [13501,5846,19592,40661,21918,20480,15565,17204,29096,0,0,0],
      '5. Industry': [40743,64320,72104,52751,67469,63789,42288,56068,11869,0,0,0],
      '6. Overig': [569,5713,-3961,21516,100,154,197,88,0,0,0,0],
    },
    Projects: {
      '1. Public': [0,0,7040,440,750,3565,90,0,0,0,0,0],
      '2. Telecom': [202696,266234,426699,334215,394127,209731,391689,-50542,292691,0,0,0],
      '3. Energy': [125972,102024,133762,94352,113353,109982,316650,153313,22192,0,0,0],
      '4. Civil': [33180,43508,38045,42492,51242,34308,71130,74691,13961,0,0,0],
      '5. Industry': [2948,8000,5763,5415,1258,958,0,346,925,0,0,0],
      '6. Overig': [0,0,358,0,0,0,0,0,0,0,0,0],
    },
    Software: {
      '1. Public': [217679,66465,55180,73186,86670,25866,20423,87560,43085,0,0,0],
      '2. Telecom': [21854,59507,26441,3703,-25481,37781,281231,137006,626,0,0,0],
      '3. Energy': [272795,140521,50516,180503,17828,140836,54921,72513,26877,0,0,0],
      '4. Civil': [7013,2552,18802,10927,1302,4094,1302,1302,1102,0,0,0],
      '5. Industry': [3213,18548,691,691,691,691,691,691,691,0,0,0],
      '6. Overig': [0,0,0,0,0,0,0,0,0,0,0,0],
    },
  },
}

/** Top-klanten per (entiteit × segment), o.b.v. omzet 2026. */
export const marktTopKlanten: Record<string, { klant: string; omzet2026: number; omzet2025: number }[]> = {
  'Consultancy|1. Public': [{ klant: "Gemeente Amsterdam", omzet2026: 90563, omzet2025: 233720 }, { klant: "CGI Nederland B.V.", omzet2026: 65334, omzet2025: 318412 }, { klant: "Gemeente Almelo", omzet2026: 0, omzet2025: 45672 }, { klant: "Synergy Four You B.V.", omzet2026: 0, omzet2025: 56718 }],
  'Consultancy|2. Telecom': [{ klant: "Allinq Networks B.V.", omzet2026: 1046661, omzet2025: 2014151 }, { klant: "BAM Telecom B.V.", omzet2026: 907805, omzet2025: 1166748 }, { klant: "Circet Nederland B.V.", omzet2026: 804494, omzet2025: 1189255 }, { klant: "SPIE Nederland B.V.", omzet2026: 673196, omzet2025: 509678 }, { klant: "Flexz Services B.V.", omzet2026: 537305, omzet2025: 126816 }, { klant: "Allinq Fiber to the Home B.V.", omzet2026: 372046, omzet2025: 768334 }],
  'Consultancy|3. Energy': [{ klant: "Alliander N.V.", omzet2026: 327770, omzet2025: 389209 }, { klant: "Circle8", omzet2026: 298592, omzet2025: 103717 }, { klant: "BGM Infra B.V.", omzet2026: 75504, omzet2025: 26736 }, { klant: "Between Staffing Nederland B.V.", omzet2026: 68510, omzet2025: 0 }, { klant: "Magnit Global Netherlands BN B.V.", omzet2026: 38382, omzet2025: 46184 }, { klant: "Enexis Holding N.V.", omzet2026: 7920, omzet2025: 395160 }],
  'Consultancy|4. Civil': [{ klant: "ViS Detachering B.V.", omzet2026: 51000, omzet2025: 113328 }, { klant: "Van Hattum en Blankevoort", omzet2026: 0, omzet2025: 59275 }, { klant: "Syntraal B.V.", omzet2026: 0, omzet2025: 28850 }, { klant: "Aveco de Bondt", omzet2026: 0, omzet2025: 9915 }, { klant: "Vialis B.V.", omzet2026: 0, omzet2025: 158374 }],
  'Consultancy|5. Industry': [{ klant: "Pas Reform B.V.", omzet2026: 202462, omzet2025: 108949 }, { klant: "IPSS Engineering B.V.", omzet2026: 84465, omzet2025: 129124 }, { klant: "Randstad Sourceright International", omzet2026: 80439, omzet2025: 252253 }, { klant: "VMI Holland B.V.", omzet2026: 77894, omzet2025: 115825 }, { klant: "Interflow", omzet2026: 25867, omzet2025: 31067 }, { klant: "TNA NL Manufacturing B.V", omzet2026: 0, omzet2025: 84542 }],
  'Consultancy|6. Overig': [{ klant: "\"Oostendorp Jos van Boxtel Locatie 's-Hertogenbosch\"", omzet2026: 21385, omzet2025: 0 }, { klant: "Dewi Online B.V.", omzet2026: 3241, omzet2025: 10610 }, { klant: "Martin de Vries", omzet2026: -250, omzet2025: 250 }, { klant: "TPG Spain S.L.", omzet2026: 0, omzet2025: 20000 }, { klant: "Renique Beheer B.V.", omzet2026: 0, omzet2025: 4551 }, { klant: "Vision Car Lease B.V.", omzet2026: 0, omzet2025: 26800 }],
  'Projects|1. Public': [{ klant: "Gemeente Apeldoorn", omzet2026: 18684, omzet2025: 19982 }, { klant: "Movares | BRO Adviseurs B.V.", omzet2026: 9845, omzet2025: 18911 }, { klant: "Gemeente Almere", omzet2026: 7542, omzet2025: 32559 }, { klant: "Projectbureau R.O. B.V. | Cuijpers Advies", omzet2026: 750, omzet2025: 0 }, { klant: "Gemeente Wijk bij Duurstede", omzet2026: 440, omzet2025: 0 }, { klant: "Plan & Omgeving B.V.", omzet2026: 330, omzet2025: 390 }],
  'Projects|2. Telecom': [{ klant: "Hanab Fiber B.V.", omzet2026: 915928, omzet2025: 1517101 }, { klant: "Van Gelder Telecom B.V.", omzet2026: 541921, omzet2025: 1329841 }, { klant: "Glaspoort B.V.", omzet2026: 380384, omzet2025: 246928 }, { klant: "Direxta Infra B.V.", omzet2026: 233738, omzet2025: 265257 }, { klant: "Allinq Advanced Solutions B.V.", omzet2026: 174841, omzet2025: 256696 }, { klant: "Allinq HFC B.V.", omzet2026: 90052, omzet2025: 111785 }],
  'Projects|3. Energy': [{ klant: "Van Gelder Kabel-, Leiding- en Montagewerken", omzet2026: 441335, omzet2025: 99381 }, { klant: "Van Voskuilen Infratechniek B.V.", omzet2026: 211951, omzet2025: 279818 }, { klant: "Enexis Netbeheer B.V.", omzet2026: 119005, omzet2025: 186724 }, { klant: "Eneco Warmtenetten B.V.", omzet2026: 113180, omzet2025: 141944 }, { klant: "Van den Heuvel Aannemingsbedrijf B.V.", omzet2026: 87437, omzet2025: 121545 }, { klant: "CIAG B.V. Communicatie Infrastructuur Advies Groep", omzet2026: 68336, omzet2025: 0 }],
  'Projects|4. Civil': [{ klant: "Antea Nederland B.V.", omzet2026: 204613, omzet2025: 431858 }, { klant: "ALSÉÉN v.o.f.", omzet2026: 89760, omzet2025: 785387 }, { klant: "HVI Infratechniek BV", omzet2026: 80121, omzet2025: 28352 }, { klant: "BAM Infraconsult B.V.", omzet2026: 39779, omzet2025: 168313 }, { klant: "David Groep B.V.", omzet2026: 6741, omzet2025: 6686 }, { klant: "Van Gelder Klever B.V.", omzet2026: 5500, omzet2025: 0 }],
  'Projects|5. Industry': [{ klant: "Firestone Industrial Products Europe", omzet2026: 13353, omzet2025: 139370 }, { klant: "Timéco Outsourcing N.V.", omzet2026: 9379, omzet2025: 0 }, { klant: "Ebert Hera B.V.", omzet2026: 1916, omzet2025: 1626 }, { klant: "ITB Maasgouw", omzet2026: 493, omzet2025: 0 }, { klant: "Axxor Technology The Netherlands", omzet2026: 400, omzet2025: 2433 }, { klant: "USG Operations V.O.F.", omzet2026: 346, omzet2025: 0 }],
  'Projects|6. Overig': [{ klant: "Stork Nederland B.V. Locatie Elsloo", omzet2026: 358, omzet2025: 0 }, { klant: "BVL Beheer", omzet2026: 0, omzet2025: 571 }],
  'Software|1. Public': [{ klant: "Gemeente Den Haag", omzet2026: 79110, omzet2025: 77595 }, { klant: "Gemeente Utrecht", omzet2026: 39570, omzet2025: 173130 }, { klant: "Gemeente Alphen aan den Rijn", omzet2026: 36079, omzet2025: 6175 }, { klant: "GVB Infra B.V.", omzet2026: 35330, omzet2025: 35806 }, { klant: "\"Gemeente 's-Hertogenbosch\"", omzet2026: 30406, omzet2025: 72840 }, { klant: "ProRail B.V.", omzet2026: 26441, omzet2025: 0 }],
  'Software|2. Telecom': [{ klant: "Hanab Telecom FttX B.V.", omzet2026: 417950, omzet2025: 151659 }, { klant: "Speer IT B.V.", omzet2026: 70749, omzet2025: 36328 }, { klant: "Terra-Digital GmbH", omzet2026: 2350, omzet2025: 0 }, { klant: "STP Fiber B.V.", omzet2026: 0, omzet2025: 861 }, { klant: "PLINQ B.V.", omzet2026: 0, omzet2025: 3017 }, { klant: "Base IP B.V.", omzet2026: 0, omzet2025: 2415 }],
  'Software|3. Energy': [{ klant: "Stedin Netbeheer B.V.", omzet2026: 610007, omzet2025: 201907 }, { klant: "Cogas Facilitaire Diensten B.V.", omzet2026: 204353, omzet2025: 205241 }, { klant: "Stedin Groep Services B.V.", omzet2026: 98100, omzet2025: 102010 }, { klant: "Brabant Water N.V.", omzet2026: 94082, omzet2025: 127438 }, { klant: "Dunea N.V.", omzet2026: 65970, omzet2025: 70675 }, { klant: "Enexis Personeel B.V.", omzet2026: 50539, omzet2025: 106138 }],
  'Software|4. Civil': [{ klant: "Witteveen+Bos", omzet2026: 104252, omzet2025: 12933 }, { klant: "Strukton Rail Nederland B.V.", omzet2026: 17500, omzet2025: 0 }, { klant: "Havenbedrijf Rotterdam N.V. Port of Rotterdam", omzet2026: 5000, omzet2025: 23210 }, { klant: "Stantec B.V.", omzet2026: 5000, omzet2025: 0 }, { klant: "HB Adviesbureau", omzet2026: 3693, omzet2025: 4850 }, { klant: "Beindorff Civieltechnische Werkzaamheden", omzet2026: 2792, omzet2025: 8778 }],
  'Software|5. Industry': [{ klant: "Colt Technology Services B.V.", omzet2026: 17880, omzet2025: 13739 }, { klant: "Delgromij B.V.", omzet2026: 6173, omzet2025: 8354 }, { klant: "Chemours Netherlands B.V.", omzet2026: 1295, omzet2025: 0 }, { klant: "Smulders Projects Netherlands B.V.", omzet2026: 1250, omzet2025: 0 }, { klant: "B&B Cable & Industrial Support B.V.", omzet2026: 0, omzet2025: 2054 }, { klant: "Tomaten van den Belt B.V.", omzet2026: 0, omzet2025: 1000 }],
  'Software|6. Overig': [{ klant: "Jon Posthuma", omzet2026: 0, omzet2025: 75 }, { klant: "Johan Brinkers", omzet2026: 0, omzet2025: 91 }, { klant: "Geomaat B.V.", omzet2026: 0, omzet2025: 198 }],
}

export const MARKT_META = {
  bron: 'SAP factuurvolume-uitdraai (CRMCIVIB_Q0001)',
  peildatum: '2026-09-17',
  laatsteVolledigeMaand: 8, // laatste factuurmaand minus de lopende (index 1-12)
  septemberLopend: true,
  internUitgesloten: -685009, // saldo interne TPG-facturen (uitgesloten)
  tAdminUitgesloten: 1975554, // KFT-reeks: holding/lease-administratie (uitgesloten)
}
