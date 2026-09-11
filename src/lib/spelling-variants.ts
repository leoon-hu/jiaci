/**
 * 英美拼写对照（英式 → 美式）。内置词库以美式为主：同一本里两种拼写都在时只留美式，只有英式时换成美式（前提是美式在 word 表里）。
 * 只列常见的原形；不含 dialogue / catalogue / whisky / storey 这类美式也通用或含义不同的词。
 */
export const BRITISH_TO_AMERICAN: Record<string, string> = {
  // -our → -or
  colour: "color", colourful: "colorful", honour: "honor", honourable: "honorable", humour: "humor", labour: "labor", labourer: "laborer",
  neighbour: "neighbor", neighbourhood: "neighborhood", neighbouring: "neighboring", flavour: "flavor", flavouring: "flavoring", favour: "favor",
  favourable: "favorable", favourite: "favorite", behaviour: "behavior", behavioural: "behavioral", harbour: "harbor", armour: "armor", rumour: "rumor",
  vapour: "vapor", odour: "odor", savour: "savor", splendour: "splendor", valour: "valor", vigour: "vigor", candour: "candor", clamour: "clamor",
  endeavour: "endeavor", parlour: "parlor", rancour: "rancor", tumour: "tumor", saviour: "savior", demeanour: "demeanor", ardour: "ardor", fervour: "fervor",
  // -re → -er
  centre: "center", centred: "centered", metre: "meter", litre: "liter", theatre: "theater", fibre: "fiber", calibre: "caliber", sombre: "somber",
  spectre: "specter", lustre: "luster", sabre: "saber", meagre: "meager", manoeuvre: "maneuver", kilometre: "kilometer", millimetre: "millimeter",
  centimetre: "centimeter", goitre: "goiter", mitre: "miter", reconnoitre: "reconnoiter",
  // -ise → -ize
  organise: "organize", organisation: "organization", realise: "realize", realisation: "realization", recognise: "recognize", apologise: "apologize",
  criticise: "criticize", emphasise: "emphasize", minimise: "minimize", maximise: "maximize", summarise: "summarize", utilise: "utilize",
  authorise: "authorize", authorisation: "authorization", characterise: "characterize", specialise: "specialize", specialisation: "specialization",
  civilise: "civilize", civilisation: "civilization", colonise: "colonize", colonisation: "colonization", memorise: "memorize", modernise: "modernize",
  modernisation: "modernization", optimise: "optimize", optimisation: "optimization", patronise: "patronize", prioritise: "prioritize", publicise: "publicize",
  standardise: "standardize", standardisation: "standardization", stabilise: "stabilize", symbolise: "symbolize", sympathise: "sympathize",
  visualise: "visualize", mobilise: "mobilize", mobilisation: "mobilization", monopolise: "monopolize", neutralise: "neutralize", normalise: "normalize",
  popularise: "popularize", privatise: "privatize", privatisation: "privatization", socialise: "socialize", subsidise: "subsidize", terrorise: "terrorize",
  vandalise: "vandalize", globalisation: "globalization", industrialise: "industrialize", industrialisation: "industrialization", urbanisation: "urbanization",
  categorise: "categorize", harmonise: "harmonize", hospitalise: "hospitalize", immunise: "immunize", jeopardise: "jeopardize", legalise: "legalize",
  liberalise: "liberalize", localise: "localize", magnetise: "magnetize", marginalise: "marginalize", mechanise: "mechanize", nationalise: "nationalize",
  naturalise: "naturalize", oxidise: "oxidize", personalise: "personalize", polarise: "polarize", pressurise: "pressurize", rationalise: "rationalize",
  revitalise: "revitalize", scrutinise: "scrutinize", sensitise: "sensitize", sterilise: "sterilize", stigmatise: "stigmatize", synchronise: "synchronize",
  synthesise: "synthesize", theorise: "theorize", tranquillise: "tranquilize", trivialise: "trivialize", vaporise: "vaporize", vocalise: "vocalize",
  westernise: "westernize", familiarise: "familiarize", fertilise: "fertilize", fertiliser: "fertilizer", finalise: "finalize", formalise: "formalize",
  generalise: "generalize", idealise: "idealize", italicise: "italicize", legitimise: "legitimize", paralyse: "paralyze", analyse: "analyze",
  catalyse: "catalyze", breathalyse: "breathalyze", digitise: "digitize", equalise: "equalize", energise: "energize", emphasised: "emphasized",
  // -ence → -ense, -ce/-se
  defence: "defense", offence: "offense", pretence: "pretense", licence: "license", practise: "practice",
  // -ll- / -l-
  travelling: "traveling", traveller: "traveler", travelled: "traveled", modelling: "modeling", labelled: "labeled", counsellor: "counselor",
  jewellery: "jewelry", woollen: "woolen", marvellous: "marvelous", cancelled: "canceled", signalling: "signaling", enrol: "enroll", enrolment: "enrollment",
  fulfil: "fulfill", fulfilment: "fulfillment", instil: "instill", instalment: "installment", skilful: "skillful", wilful: "willful",
  // -ae-/-oe- → -e-
  encyclopaedia: "encyclopedia", anaemia: "anemia", anaesthesia: "anesthesia", anaesthetic: "anesthetic", paediatric: "pediatric", haemorrhage: "hemorrhage",
  foetus: "fetus", oesophagus: "esophagus", diarrhoea: "diarrhea", leukaemia: "leukemia", mediaeval: "medieval", orthopaedic: "orthopedic", gynaecology: "gynecology",
  // 其它常见
  programme: "program", grey: "gray", tyre: "tire", kerb: "curb", plough: "plow", cheque: "check", aeroplane: "airplane", aluminium: "aluminum",
  cosy: "cozy", draught: "draft", pyjamas: "pajamas", sceptical: "skeptical", sceptic: "skeptic", mum: "mom", maths: "math", ageing: "aging",
  judgement: "judgment", acknowledgement: "acknowledgment", gaol: "jail", sulphur: "sulfur", mould: "mold", moult: "molt", moustache: "mustache",
  omelette: "omelet", yoghurt: "yogurt", artefact: "artifact", speciality: "specialty", orientated: "oriented", furore: "furor", smoulder: "smolder",
  doughnut: "donut", pedlar: "peddler", tsar: "czar", whilst: "while", amongst: "among", learnt: "learned", spelt: "spelled", dreamt: "dreamed",
  // 其他
  "co-operate": "cooperate", "co-operation": "cooperation", "co-operative": "cooperative", "co-operatively": "cooperatively", "co-ordinate": "coordinate",
  "co-ordination": "coordination", "co-ordinator": "coordinator", waggon: "wagon", defenceless: "defenseless",
};
