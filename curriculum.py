"""The situation spine for the trainer's word order.

Derived from the Duolingo French-from-English unit titles, sections 1-6 (CEFR Intro
through B1) — the sequence a course designer arrived at for can-do situations, which
is what we want and what a frequency list has no opinion about. Duolingo's units are
merged and deduped here into 34 situations; their order is Duolingo's, not ours.

Each situation carries a SEED list. Seeds are the words that make the situation what
it is. A word in the frequency pool that matches a seed is pulled forward to that
situation; everything unclaimed stays in frequency order behind the themed run.

Situations, not semantic sets. "the cafe" holds a noun, a verb, a person and a number
because that is what one scene is made of. A set of all-the-colours or all-the-family
is the shape that measurably slows learning (Tinkham 1993, Waring 1997, Erten & Tekin
2008 — see ../resources/vocabulary.md), so no situation here is a single category.

Function words are deliberately absent from every seed list. They are scheduled by
encounter count instead: a function word earns its card only once the example
sentences already on the schedule have shown it MIN_ENCOUNTERS times. Conti (2025)
puts the requirement at 30-40 encounters across all skills for these to stick; the
card is meant to arrive after recognition has started, not before it.
"""

# A function word needs to appear in this many already-scheduled example sentences
# before it gets a card of its own.
MIN_ENCOUNTERS = 3

# pos tags in the pool that count as function words
FUNCTION_POS = {"prep.", "conj.", "pron.", "det.", "art.", "aux."}

# Ammaar's call (2026-08-27): sequence by his day, not by Duolingo's order. The unit
# titles and the situation split are Duolingo's; which situation comes first is his.
# "The more of those words I know, the more I'll actually use them day-to-day. I'll
# actually practice it, and that way I will just pick it up faster."
#
#   tier 1  who I am, who is around me, what is in the flat
#   tier 2  my week, what I do in it, what I say about it
#   tier 3  leaving the flat
#   tier 4  the wider world, and the exam's topic areas
PRIORITY = [
    # tier 1 — who I am and what is around me
    "essentials", "greetings", "introduce", "family", "describe-people",
    "home", "household", "numbers", "time",
    # tier 2 — my week
    "routine", "food-drink", "cooking", "groceries", "work",
    "free-time", "feelings", "opinions", "questions",
    # tier 3 — leaving the flat
    "town", "directions", "transit", "money", "clothes", "weather", "body-health",
    # tier 4 — the wider world
    "school", "travel", "hotel", "nature", "sport", "media", "problems",
    "society", "environment",
]

# Ordered. Each entry: (slug, title, [seed lemmas])
SITUATIONS = [
    ("essentials", "Use basic phrases", [
        "oui", "non", "merci", "pardon", "excuser", "plaire", "aider", "comprendre",
        "parler", "répéter", "lentement", "problème", "accord", "voilà", "bien",
        "mal", "peut-être", "vraiment", "beaucoup", "encore",
    ]),
    ("greetings", "Greet people", [
        "bonjour", "bonsoir", "salut", "revoir", "madame", "monsieur", "mademoiselle",
        "aller", "ça", "content", "ravi", "rencontrer", "présenter", "bienvenue",
        "matin", "soir", "nuit", "journée", "demain", "bientôt",
    ]),
    ("introduce", "Introduce yourself", [
        "nom", "prénom", "appeler", "être", "âge", "an", "habiter", "venir", "pays",
        "français", "anglais", "canadien", "ville", "adresse", "né", "vivre",
        "célibataire", "marié", "langue", "apprendre",
    ]),
    ("numbers", "Count and quantify", [
        "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
        "vingt", "cent", "mille", "million", "premier", "dernier", "demi", "moitié",
        "nombre", "chiffre", "compter", "plusieurs", "quelques", "assez", "trop",
    ]),
    ("family", "Refer to family members", [
        "famille", "père", "mère", "parent", "fils", "fille", "frère", "sœur",
        "enfant", "bébé", "mari", "femme", "oncle", "tante", "cousin", "grand-père",
        "grand-mère", "neveu", "nièce", "petit-fils",
    ]),
    ("describe-people", "Describe people", [
        "grand", "petit", "jeune", "vieux", "beau", "joli", "gros", "mince", "fort",
        "cheveu", "yeux", "blond", "brun", "gentil", "sympathique", "drôle",
        "sérieux", "timide", "intelligent", "âgé",
    ]),
    ("body-health", "Talk about your health", [
        "corps", "tête", "main", "pied", "bras", "jambe", "dos", "cœur", "ventre",
        "bouche", "nez", "oreille", "dent", "peau", "sang", "malade", "santé",
        "douleur", "fatigué", "dormir", "médecin", "hôpital", "médicament", "fièvre",
    ]),
    ("food-drink", "Order food and drink", [
        "manger", "boire", "restaurant", "café", "eau", "vin", "bière", "thé", "lait",
        "pain", "menu", "carte", "table", "serveur", "addition", "commander",
        "plat", "entrée", "dessert", "faim", "soif", "bon", "délicieux", "goût",
    ]),
    ("groceries", "Shop for groceries", [
        "marché", "magasin", "acheter", "vendre", "prix", "cher", "kilo", "sac",
        "fruit", "légume", "pomme", "viande", "poisson", "poulet", "fromage", "œuf",
        "riz", "sucre", "sel", "beurre", "frais", "produit",
    ]),
    ("cooking", "Talk about cooking", [
        "cuisine", "cuisiner", "recette", "couper", "chaud", "froid", "four",
        "casserole", "assiette", "verre", "couteau", "fourchette", "cuillère",
        "préparer", "servir", "goûter", "mélanger", "bouillir", "huile", "farine",
    ]),
    ("home", "Describe your home", [
        "maison", "appartement", "chambre", "salon", "cuisine", "salle", "porte",
        "fenêtre", "mur", "sol", "toit", "escalier", "jardin", "étage", "clé",
        "lit", "chaise", "meuble", "loyer", "voisin",
    ]),
    ("household", "Describe household tasks", [
        "ménage", "nettoyer", "laver", "ranger", "poubelle", "linge", "cuisiner",
        "vaisselle", "aspirateur", "machine", "réparer", "casser", "allumer",
        "éteindre", "lumière", "eau", "électricité", "chauffage", "outil", "bricoler",
    ]),
    ("clothes", "Shop for clothes", [
        "vêtement", "porter", "robe", "pantalon", "chemise", "veste", "manteau",
        "chaussure", "chapeau", "jupe", "pull", "taille", "essayer", "couleur",
        "noir", "blanc", "rouge", "bleu", "vert", "mode",
    ]),
    ("money", "Talk about spending money", [
        "argent", "euro", "payer", "coûter", "carte", "banque", "compte", "monnaie",
        "billet", "gratuit", "dépenser", "économiser", "riche", "pauvre", "facture",
        "salaire", "impôt", "prêt", "dette", "caisse",
    ]),
    ("time", "Tell the time", [
        "heure", "minute", "seconde", "jour", "semaine", "mois", "année", "lundi",
        "mardi", "samedi", "dimanche", "janvier", "juillet", "aujourd'hui", "hier",
        "demain", "matin", "midi", "tard", "tôt", "montre", "calendrier",
    ]),
    ("routine", "Describe your routine", [
        "réveiller", "lever", "coucher", "habiller", "doucher", "brosser",
        "déjeuner", "dîner", "petit-déjeuner", "partir", "rentrer", "sortir",
        "commencer", "finir", "habitude", "toujours", "souvent", "jamais", "parfois",
    ]),
    ("work", "Talk about your job", [
        "travail", "travailler", "bureau", "entreprise", "patron", "collègue",
        "métier", "emploi", "réunion", "projet", "client", "chef", "employé",
        "contrat", "carrière", "stage", "candidat", "poste", "équipe", "responsable",
    ]),
    ("school", "Talk about school", [
        "école", "étudier", "étudiant", "professeur", "cours", "classe", "livre",
        "lire", "écrire", "examen", "note", "devoir", "université", "leçon",
        "cahier", "stylo", "papier", "mot", "question", "réponse", "expliquer",
    ]),
    ("town", "Get around town", [
        "ville", "rue", "place", "quartier", "centre", "église", "musée", "parc",
        "pont", "immeuble", "poste", "pharmacie", "boulangerie", "hôtel", "gare",
        "aéroport", "route", "adresse", "coin", "bâtiment",
    ]),
    ("directions", "Get directions", [
        "gauche", "droite", "droit", "tourner", "continuer", "traverser", "loin",
        "près", "ici", "là", "devant", "derrière", "côté", "entre", "carrefour",
        "chemin", "plan", "perdre", "trouver", "arriver",
    ]),
    ("transit", "Make transit plans", [
        "train", "bus", "métro", "voiture", "vélo", "avion", "taxi", "billet",
        "quai", "arrêt", "conduire", "monter", "descendre", "retard", "départ",
        "arrivée", "voyage", "ligne", "station", "circulation",
    ]),
    ("travel", "Make vacation plans", [
        "voyager", "vacances", "valise", "passeport", "réserver", "séjour",
        "plage", "mer", "montagne", "camping", "touriste", "visiter", "étranger",
        "frontière", "bagage", "carte", "guide", "souvenir", "louer", "assurance",
    ]),
    ("hotel", "Communicate at a hotel", [
        "hôtel", "chambre", "réception", "réserver", "nuit", "libre", "occupé",
        "ascenseur", "clé", "bagage", "petit-déjeuner", "propre", "sale", "bruit",
        "calme", "vue", "étage", "douche", "serviette", "confortable",
    ]),
    ("weather", "Talk about the weather", [
        "temps", "pleuvoir", "neiger", "soleil", "pluie", "neige", "vent", "nuage",
        "chaud", "froid", "orage", "ciel", "degré", "saison", "printemps", "été",
        "automne", "hiver", "humide", "sec",
    ]),
    ("nature", "Talk about nature", [
        "nature", "arbre", "fleur", "herbe", "forêt", "rivière", "lac", "champ",
        "animal", "chien", "chat", "oiseau", "cheval", "poisson", "terre", "pierre",
        "feuille", "campagne", "île", "jardin",
    ]),
    ("free-time", "Talk about free time", [
        "loisir", "musique", "film", "cinéma", "jouer", "danser", "chanter",
        "sortir", "ami", "fête", "jeu", "chanson", "théâtre", "concert", "photo",
        "dessiner", "collection", "passion", "amuser", "détendre",
    ]),
    ("sport", "Talk about exercise", [
        "sport", "courir", "nager", "marcher", "match", "équipe", "gagner", "perdre",
        "joueur", "ballon", "football", "tennis", "vélo", "entraîner", "exercice",
        "stade", "champion", "muscle", "sauter", "danse",
    ]),
    ("media", "Talk about the internet", [
        "internet", "ordinateur", "téléphone", "appeler", "message", "écran",
        "site", "réseau", "envoyer", "chercher", "information", "journal",
        "télévision", "radio", "nouvelle", "publicité", "vidéo", "compte",
        "mot de passe", "application",
    ]),
    ("feelings", "Express feelings", [
        "sentir", "heureux", "triste", "peur", "colère", "aimer", "détester",
        "espérer", "rire", "pleurer", "surprise", "inquiet", "calme", "nerveux",
        "seul", "fier", "honte", "envie", "besoin", "plaisir",
    ]),
    ("opinions", "Express opinions", [
        "penser", "croire", "avis", "idée", "raison", "tort", "vrai", "faux",
        "sûr", "peut-être", "évident", "important", "intéressant", "difficile",
        "facile", "possible", "impossible", "préférer", "choisir", "décider",
    ]),
    ("questions", "Ask questions", [
        "question", "demander", "répondre", "pourquoi", "comment", "quand", "où",
        "combien", "quel", "qui", "savoir", "connaître", "expliquer", "montrer",
        "curieux", "renseignement", "information", "chercher", "vérifier",
    ]),
    ("problems", "Communicate in an emergency", [
        "aide", "secours", "urgence", "police", "pompier", "accident", "danger",
        "blessé", "feu", "voler", "attention", "risque", "grave", "sécurité",
        "peur", "erreur", "faute", "casser", "tomber", "arrêter",
    ]),
    ("society", "Discuss social issues", [
        "société", "gouvernement", "politique", "loi", "pays", "guerre", "paix",
        "élection", "citoyen", "droit", "liberté", "égalité", "manifestation",
        "grève", "population", "religion", "histoire", "culture",
        "immigration",
    ]),
    ("environment", "Talk about the environment", [
        "environnement", "planète", "climat", "pollution", "déchet", "recycler",
        "énergie", "nature", "protéger", "espèce", "forêt", "océan", "eau",
        "propre", "durable", "consommation", "réchauffement", "ressource",
        "biologique", "transport",
    ]),
]
