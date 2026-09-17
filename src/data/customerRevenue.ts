/**
 * Omzet (gefactureerde nettowaarde) per entiteit × marktsegment × maand.
 * Bron: SAP-factuurvolume-uitdraai (CRMCIVIB_Q0001) van 17-09-2026, facturen vanaf 01-01-2024.
 * Entiteit-toewijzing via "Verantwoordelijke eenheid (Project)" op de factuur;
 * marktsegment via de Bedrijfstak-kolom (zelfde indeling als het sales dashboard).
 * Interne TPG-facturen en TPG Spanje zijn uitgesloten. September 2026 is een lopende maand.
 * Regenereren: zie scratch-scripts extract-klantomzet.mjs + generate-data2.mjs (sessie 17-09-2026).
 */
export const MARKT_ENTITIES = ['Consultancy', 'Projects', 'Software'] as const
export const MARKT_SEGMENTS = ["1. Public","2. Telecom","3. Energy","4. Civil","5. Industry","6. Overig","Niet toegewezen"] as const
export type MarktEntity = typeof MARKT_ENTITIES[number]
export type MarktSegment = typeof MARKT_SEGMENTS[number]

/** [jaar][entiteit][segment] = 12 maandbedragen (index 0 = januari). */
export const marktOmzet: Record<'2024' | '2025' | '2026', Record<MarktEntity, Record<MarktSegment, number[]>>> = {
  '2024': {
    Consultancy: {
      '1. Public': [37718,48623,54071,63595,157289,83129,55557,35138,54869,86248,96977,39207],
      '2. Telecom': [745953,1047262,970561,831477,837726,793009,754492,665640,662590,981345,803719,710800],
      '3. Energy': [131703,170707,141336,206455,213073,175258,129981,147522,136431,185297,226178,144961],
      '4. Civil': [38474,41000,36485,39613,35132,26526,42434,39780,31096,66424,43775,37280],
      '5. Industry': [138530,138466,124924,101823,92489,92290,88949,68384,54530,108488,77986,84016],
      '6. Overig': [0,0,0,0,0,0,0,0,0,0,4522,1750],
      'Niet toegewezen': [0,161,0,0,0,0,0,0,0,0,0,0],
    },
    Projects: {
      '1. Public': [23497,3882,6634,5451,2610,6685,4355,3977,10465,9854,8281,5562],
      '2. Telecom': [402342,383678,344196,356425,537734,406934,342598,408674,323908,457547,635972,249125],
      '3. Energy': [40995,42088,59154,78965,43978,52589,49975,49935,46572,108073,119503,51184],
      '4. Civil': [17889,161692,188633,32214,161019,105530,82789,104476,80226,109722,144094,96318],
      '5. Industry': [3540,3975,40699,63544,113,1790,1280,62437,27065,285,1118,2342],
      '6. Overig': [0,1575,0,0,0,0,0,0,0,0,0,0],
      'Niet toegewezen': [0,0,0,0,0,0,0,0,0,0,0,0],
    },
    Software: {
      '1. Public': [451561,172747,146467,187178,151300,103963,118235,144972,48341,124216,180889,442739],
      '2. Telecom': [88875,562,179955,562,5662,8878,3089,57612,7794,60272,242,563],
      '3. Energy': [187207,40967,89489,30218,91478,33845,51187,-3972,52388,96100,53326,110706],
      '4. Civil': [9872,4194,1044,2930,26388,24349,5783,4816,2339,1119,12952,5475],
      '5. Industry': [3400,14094,620,-12583,4698,13005,287,6414,6761,10528,637,637],
      '6. Overig': [7049,500,3719,1527,240,0,3108,216,2230,3197,5065,1484],
      'Niet toegewezen': [0,0,0,0,0,106,0,0,106,0,0,0],
    },
  },
  '2025': {
    Consultancy: {
      '1. Public': [55771,39422,82799,49567,67165,65002,50936,55042,40428,37781,40781,45881],
      '2. Telecom': [646719,770140,841610,734834,850457,674573,685340,519130,711159,935663,558092,672039],
      '3. Energy': [102335,159029,82784,135334,75032,132847,93679,92745,92421,131297,117745,92829],
      '4. Civil': [47886,74741,72160,43240,80939,45102,52950,30719,49405,31177,21133,16760],
      '5. Industry': [76499,79925,83328,54536,63317,70468,63854,53228,69036,110444,99295,64426],
      '6. Overig': [14364,9576,10108,10374,17257,5485,3566,263,941,985,525,503],
      'Niet toegewezen': [0,0,0,0,857,0,0,0,0,0,0,0],
    },
    Projects: {
      '1. Public': [1115,730,3091,2400,675,3403,135,573,1143,910,9147,6276],
      '2. Telecom': [283279,376438,495769,192432,278461,586297,331764,338870,298886,457448,372278,364661],
      '3. Energy': [46633,65250,113027,47024,125867,77748,84524,85212,105456,93260,107391,99881],
      '4. Civil': [122791,18948,107158,101497,205017,94184,101361,131074,82619,71222,80601,146929],
      '5. Industry': [1961,0,0,0,15297,24890,5921,5994,12344,26848,-4471,4640],
      '6. Overig': [0,0,0,0,0,0,0,0,0,0,0,0],
      'Niet toegewezen': [0,0,0,0,0,0,0,0,0,0,0,0],
    },
    Software: {
      '1. Public': [338609,171801,131898,196148,47725,72096,148539,39829,127462,93755,324747,1020984],
      '2. Telecom': [84470,70959,1588,-17095,13740,7050,10180,26105,9999,2410,6764,52928],
      '3. Energy': [190769,105002,-20690,46196,48352,45197,74981,29603,37418,72180,32922,83916],
      '4. Civil': [16396,1582,3607,9666,8905,9262,1224,2011,20591,1062,44434,8182],
      '5. Industry': [982,12551,668,1531,668,803,8586,4368,668,1815,2008,948],
      '6. Overig': [0,1135,1179,16838,1368,0,0,0,2873,4428,1754,3481],
      'Niet toegewezen': [0,0,0,0,0,99,2300,0,0,5789,4433,1495],
    },
  },
  '2026': {
    Consultancy: {
      '1. Public': [22834,15057,6672,27781,17532,13302,16918,18551,0,0,0,0],
      '2. Telecom': [557933,610392,707049,783881,604685,596408,521704,425732,196759,0,0,0],
      '3. Energy': [83580,100855,220674,169283,156362,245264,188137,184394,86879,0,0,0],
      '4. Civil': [13501,5846,19592,40661,21918,20480,15565,17204,4096,0,0,0],
      '5. Industry': [40743,64320,72439,53108,67469,64106,42288,56068,11869,0,0,0],
      '6. Overig': [569,5010,-4047,131,350,154,197,88,0,0,0,0],
      'Niet toegewezen': [0,0,37659,39627,40888,11326,25143,36017,11940,0,0,0],
    },
    Projects: {
      '1. Public': [0,0,7040,440,750,3565,90,0,0,0,0,0],
      '2. Telecom': [202696,266234,426699,334215,394127,209731,391689,173853,68296,0,0,0],
      '3. Energy': [125972,102024,133762,94154,113353,109501,316650,153313,22192,0,0,0],
      '4. Civil': [33180,43508,38045,42492,51242,33590,70690,74691,13961,0,0,0],
      '5. Industry': [2948,8000,5763,5415,1258,958,0,346,925,0,0,0],
      '6. Overig': [0,0,0,0,0,0,0,0,0,0,0,0],
      'Niet toegewezen': [0,0,0,0,0,718,0,0,0,0,0,0],
    },
    Software: {
      '1. Public': [217679,53444,55080,73186,86670,25767,20423,87560,43085,0,0,0],
      '2. Telecom': [21854,59507,25156,2019,1231,37781,281231,137006,626,0,0,0],
      '3. Energy': [270320,140521,50516,176393,17318,140326,53411,72003,26877,0,0,0],
      '4. Civil': [6813,1102,18602,10727,1102,3894,1102,1102,1102,0,0,0],
      '5. Industry': [1963,18548,691,691,691,691,691,691,691,0,0,0],
      '6. Overig': [1250,0,0,0,0,0,1000,0,0,0,0,0],
      'Niet toegewezen': [200,200,300,6660,710,809,710,710,0,0,0,0],
    },
  },
}

/** Top-klanten per (entiteit × segment), o.b.v. omzet 2026 t/m september. */
export const marktTopKlanten: Record<string, { klant: string; omzet2026: number; omzet2025: number }[]> = {
  'Consultancy|1. Public': [{ klant: "Gemeente Amsterdam", omzet2026: 90563, omzet2025: 233720 }, { klant: "CGI Nederland B.V.", omzet2026: 65334, omzet2025: 318412 }, { klant: "Gemeente Almelo", omzet2026: 0, omzet2025: 45672 }, { klant: "Synergy Four You B.V.", omzet2026: 0, omzet2025: 56718 }],
  'Consultancy|2. Telecom': [{ klant: "Allinq Networks B.V.", omzet2026: 1043240, omzet2025: 2013985 }, { klant: "BAM Telecom B.V.", omzet2026: 908344, omzet2025: 1160745 }, { klant: "Circet Nederland B.V.", omzet2026: 791253, omzet2025: 1188333 }, { klant: "SPIE Nederland B.V.", omzet2026: 771496, omzet2025: 519921 }, { klant: "Flexz Services B.V.", omzet2026: 536651, omzet2025: 126816 }, { klant: "Allinq Fiber to the Home B.V.", omzet2026: 372046, omzet2025: 767213 }],
  'Consultancy|3. Energy': [{ klant: "Alliander N.V.", omzet2026: 333475, omzet2025: 396896 }, { klant: "Circle8", omzet2026: 298592, omzet2025: 103717 }, { klant: "BGM Infra B.V.", omzet2026: 75504, omzet2025: 26736 }, { klant: "Magnit Global Netherlands BN B.V.", omzet2026: 38382, omzet2025: 46184 }, { klant: "Enexis Holding N.V.", omzet2026: 7920, omzet2025: 395160 }, { klant: "Heijmans Infra B.V.", omzet2026: 1791, omzet2025: 19743 }],
  'Consultancy|4. Civil': [{ klant: "ViS Detachering B.V.", omzet2026: 51000, omzet2025: 113328 }, { klant: "Van Hattum en Blankevoort", omzet2026: 0, omzet2025: 59275 }, { klant: "Syntraal B.V.", omzet2026: 0, omzet2025: 28850 }, { klant: "Aveco de Bondt", omzet2026: 0, omzet2025: 11915 }, { klant: "Vialis B.V.", omzet2026: 0, omzet2025: 154293 }],
  'Consultancy|5. Industry': [{ klant: "Pas Reform B.V.", omzet2026: 202462, omzet2025: 108949 }, { klant: "IPSS Engineering B.V.", omzet2026: 84465, omzet2025: 129124 }, { klant: "Randstad Sourceright International", omzet2026: 80439, omzet2025: 252253 }, { klant: "VMI Holland B.V.", omzet2026: 78903, omzet2025: 115825 }, { klant: "Interflow", omzet2026: 25867, omzet2025: 31067 }, { klant: "TNA NL Manufacturing B.V", omzet2026: 0, omzet2025: 85910 }],
  'Consultancy|6. Overig': [{ klant: "Dewi Online B.V.", omzet2026: 2452, omzet2025: 10610 }, { klant: "Renique Beheer B.V.", omzet2026: 0, omzet2025: 4551 }, { klant: "Itaq B.V.", omzet2026: 0, omzet2025: 58786 }],
  'Consultancy|Niet toegewezen': [{ klant: "Between Staffing Nederland B.V.", omzet2026: 70720, omzet2025: 0 }, { klant: "Flexz Services", omzet2026: 67160, omzet2025: 0 }, { klant: "TOF Services B.V.", omzet2026: 58039, omzet2025: 0 }, { klant: "HVC CAI-Techniek B.V.", omzet2026: 5045, omzet2025: 0 }, { klant: "Haert", omzet2026: 1636, omzet2025: 0 }, { klant: "Dietz Power B.V.", omzet2026: 0, omzet2025: 857 }],
  'Projects|1. Public': [{ klant: "Gemeente Apeldoorn", omzet2026: 18684, omzet2025: 19982 }, { klant: "Movares | BRO Adviseurs B.V.", omzet2026: 9845, omzet2025: 18911 }, { klant: "Gemeente Almere", omzet2026: 7542, omzet2025: 32559 }, { klant: "Projectbureau R.O. B.V. | Cuijpers Advies", omzet2026: 750, omzet2025: 0 }, { klant: "Gemeente Wijk bij Duurstede", omzet2026: 440, omzet2025: 0 }, { klant: "Plan & Omgeving B.V.", omzet2026: 330, omzet2025: 390 }],
  'Projects|2. Telecom': [{ klant: "Hanab Fiber B.V.", omzet2026: 915928, omzet2025: 1532493 }, { klant: "Van Gelder Telecom B.V.", omzet2026: 568050, omzet2025: 1294767 }, { klant: "Glaspoort B.V.", omzet2026: 380384, omzet2025: 246928 }, { klant: "Direxta Infra B.V.", omzet2026: 233738, omzet2025: 265257 }, { klant: "Allinq Advanced Solutions B.V.", omzet2026: 174841, omzet2025: 256696 }, { klant: "Allinq HFC B.V.", omzet2026: 90052, omzet2025: 111476 }],
  'Projects|3. Energy': [{ klant: "Van Gelder Kabel-, Leiding- en Montagewerken", omzet2026: 441335, omzet2025: 99149 }, { klant: "Van Voskuilen Infratechniek B.V.", omzet2026: 211951, omzet2025: 279818 }, { klant: "Enexis Netbeheer B.V.", omzet2026: 119005, omzet2025: 186724 }, { klant: "Eneco Warmtenetten B.V.", omzet2026: 113180, omzet2025: 147474 }, { klant: "Van den Heuvel Aannemingsbedrijf B.V.", omzet2026: 87437, omzet2025: 121545 }, { klant: "CIAG B.V. Communicatie Infrastructuur Advies Groep", omzet2026: 68336, omzet2025: 0 }],
  'Projects|4. Civil': [{ klant: "Antea Nederland B.V.", omzet2026: 204173, omzet2025: 432261 }, { klant: "ALSÉÉN v.o.f.", omzet2026: 89760, omzet2025: 785387 }, { klant: "HVI Infratechniek BV", omzet2026: 80121, omzet2025: 28352 }, { klant: "BAM Infraconsult B.V.", omzet2026: 14779, omzet2025: 168313 }, { klant: "David Groep B.V.", omzet2026: 6741, omzet2025: 6686 }, { klant: "Van Gelder Klever B.V.", omzet2026: 5500, omzet2025: 0 }],
  'Projects|5. Industry': [{ klant: "Firestone Industrial Products Europe", omzet2026: 13353, omzet2025: 139370 }, { klant: "Timéco Outsourcing N.V.", omzet2026: 9379, omzet2025: 0 }, { klant: "Ebert Hera B.V.", omzet2026: 1916, omzet2025: 1626 }, { klant: "ITB Maasgouw", omzet2026: 493, omzet2025: 0 }, { klant: "Axxor Technology The Netherlands", omzet2026: 400, omzet2025: 2433 }, { klant: "USG Operations V.O.F.", omzet2026: 346, omzet2025: 0 }],
  'Projects|Niet toegewezen': [{ klant: "Naderi Designs", omzet2026: 718, omzet2025: 0 }],
  'Software|1. Public': [{ klant: "Gemeente Den Haag", omzet2026: 79110, omzet2025: 77595 }, { klant: "Gemeente Utrecht", omzet2026: 39570, omzet2025: 171680 }, { klant: "GVB Infra B.V.", omzet2026: 35330, omzet2025: 35806 }, { klant: "\"Gemeente 's-Hertogenbosch\"", omzet2026: 30406, omzet2025: 72840 }, { klant: "ProRail B.V.", omzet2026: 26441, omzet2025: 0 }, { klant: "Gemeente Delft", omzet2026: 26125, omzet2025: 0 }],
  'Software|2. Telecom': [{ klant: "Hanab Telecom FttX B.V.", omzet2026: 417950, omzet2025: 151659 }, { klant: "Speer IT B.V.", omzet2026: 70382, omzet2025: 36328 }, { klant: "STP Fiber B.V.", omzet2026: 0, omzet2025: 861 }, { klant: "PLINQ B.V.", omzet2026: 0, omzet2025: 3017 }, { klant: "MDF Infra B.V.", omzet2026: 0, omzet2025: 6059 }, { klant: "VolkerWessels IT B.V.", omzet2026: 0, omzet2025: 1225 }],
  'Software|3. Energy': [{ klant: "Stedin Netbeheer B.V.", omzet2026: 610007, omzet2025: 201907 }, { klant: "Cogas Facilitaire Diensten B.V.", omzet2026: 204376, omzet2025: 203806 }, { klant: "Stedin Groep Services B.V.", omzet2026: 98100, omzet2025: 102010 }, { klant: "Brabant Water N.V.", omzet2026: 94082, omzet2025: 127438 }, { klant: "Dunea N.V.", omzet2026: 65970, omzet2025: 70675 }, { klant: "Enexis Personeel B.V.", omzet2026: 50058, omzet2025: 106138 }],
  'Software|4. Civil': [{ klant: "Witteveen+Bos", omzet2026: 103002, omzet2025: 12933 }, { klant: "Strukton Rail Nederland B.V.", omzet2026: 17500, omzet2025: 0 }, { klant: "Havenbedrijf Rotterdam N.V. Port of Rotterdam", omzet2026: 5000, omzet2025: 23210 }, { klant: "Stantec B.V.", omzet2026: 5000, omzet2025: 0 }, { klant: "HB Adviesbureau", omzet2026: 3693, omzet2025: 4850 }, { klant: "Beindorff Civieltechnische Werkzaamheden", omzet2026: 2792, omzet2025: 8778 }],
  'Software|5. Industry': [{ klant: "Colt Technology Services B.V.", omzet2026: 17880, omzet2025: 13739 }, { klant: "Delgromij B.V.", omzet2026: 6173, omzet2025: 8354 }, { klant: "Chemours Netherlands B.V.", omzet2026: 1295, omzet2025: 0 }, { klant: "B&B Cable & Industrial Support B.V.", omzet2026: 0, omzet2025: 2054 }, { klant: "Tata Steel IJmuiden B.V.", omzet2026: 0, omzet2025: 7918 }, { klant: "Royal Fassin B.V.", omzet2026: 0, omzet2025: 1138 }],
  'Software|6. Overig': [{ klant: "Smulders Projects Netherlands B.V.", omzet2026: 1250, omzet2025: 0 }, { klant: "HAS green academy", omzet2026: 1000, omzet2025: 0 }, { klant: "Vermeulen Oosteind B.V.", omzet2026: 0, omzet2025: 679 }, { klant: "Tuinbouwcombinatie Harmelerwaard B.V.", omzet2026: 0, omzet2025: 905 }, { klant: "Sligro Food Group Nederland B.V.", omzet2026: 0, omzet2025: 398 }, { klant: "P. van der Haak Handelskwekerij B.V.", omzet2026: 0, omzet2025: 650 }],
  'Software|Niet toegewezen': [{ klant: "Power2Create B.V.", omzet2026: 6150, omzet2025: 0 }, { klant: "Terra-Digital GmbH", omzet2026: 2350, omzet2025: 0 }, { klant: "QUB Afbouwgroep B.V.", omzet2026: 1600, omzet2025: 200 }, { klant: "PS INDUS B.V.", omzet2026: 100, omzet2025: 0 }, { klant: "Marja Folman", omzet2026: 99, omzet2025: 0 }, { klant: "Tomaten van den Belt B.V.", omzet2026: 0, omzet2025: 1000 }],
}

export const MARKT_META = {
  bron: 'SAP factuurvolume-uitdraai (CRMCIVIB_Q0001)',
  peildatum: '2026-09-17',
  laatsteVolledigeMaand: 8, // augustus (index 1-12)
  septemberLopend: true,
  internUitgesloten: -685009, // saldo interne TPG-facturen (uitgesloten)
}
