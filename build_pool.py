"""Build web/frequency-3000.json: the top 3,000 French lemmas by cross-register
frequency, each with an English gloss and IPA.

Sources
  Lexique 3.83   http://www.lexique.org        frequency, lemma, POS, gender, phonetics
  Wiktionary     https://kaikki.org/dictionary/French/   English glosses

Both are share-alike licensed; see web/README.md for the attribution note.

Usage: python3 build_pool.py Lexique383.tsv kaikki-fr.jsonl out.json
"""
import csv, json, math, re, sys, collections

N = 3000

# ---------- Lexique SAMPA -> IPA ----------

SAMPA_IPA = {
    '5': 'ɛ̃', '1': 'œ̃', '@': 'ɑ̃', '§': 'ɔ̃',
    'a': 'a', 'A': 'ɑ', 'e': 'e', 'E': 'ɛ', 'i': 'i', 'o': 'o', 'O': 'ɔ',
    'u': 'u', 'y': 'y', '2': 'ø', '9': 'œ', '°': 'ə',
    'j': 'j', 'w': 'w', '8': 'ɥ',
    'p': 'p', 'b': 'b', 't': 't', 'd': 'd', 'k': 'k', 'g': 'ɡ',
    'f': 'f', 'v': 'v', 's': 's', 'z': 'z', 'S': 'ʃ', 'Z': 'ʒ',
    'm': 'm', 'n': 'n', 'N': 'ɲ', 'G': 'ŋ', 'l': 'l', 'R': 'ʁ', 'x': 'x',
}

def to_ipa(phon):
    out = []
    for ch in phon:
        if ch not in SAMPA_IPA:
            return None
        out.append(SAMPA_IPA[ch])
    return '/' + ''.join(out) + '/'

# ---------- what counts as a vocabulary item ----------

KEEP = {'NOM', 'VER', 'ADJ', 'ADV', 'PRE', 'CON', 'AUX',
        'PRO:per', 'PRO:ind', 'PRO:rel', 'PRO:dem', 'PRO:pos', 'PRO:int',
        'ADJ:num', 'ADJ:ind', 'ADJ:pos', 'ADJ:dem', 'ADJ:int',
        'ART:def', 'ART:ind'}

# elided forms and article variants duplicate their lemma
ELIDED = {"l'", "d'", "j'", "n'", "s'", "c'", "m'", "t'", "qu'",
          "la", "les", "une", "des", "du", "au", "aux"}

# abbreviations and corpus noise, not vocabulary
NOISE = {'m', 'mme', 'mlle', 'etc', 'in', 'ok', 'miss', 'mr'}

# inflected forms Lexique failed to fold into their lemma. The base lemma is in the
# list already, so these would only produce duplicate cards.
INFLECTED = {
    'cette', 'ma', 'ces', 'nos', 'quelques', 'leurs', 'quelle', 'quels', 'quelles',
    'vos', 'autres', "d'autres", 'ceux', 'ceux-là', 'celle', 'celles', 'celle-ci',
    'celle-là', 'aucune', 'nouvelle', 'toute', 'toutes', 'laquelle', 'lesquelles',
    'lesquels', 'certains', 'certaines', 'telle', 'tels', 'telles', 'cents',
    'vieil', 'vu', 'nulle', 'venu', 'arrivé', 'uns', 'chacune', 'bijoux',
    'continue', 'mêmes', 'fonds', 'mienne', 'miens', 'sienne', 'nôtres',
}

# Glosses Wiktionary states at essay length. These are the words worth being exact about.
OVERRIDE = {
    'pas': 'not (the standard negation, with ne)',
    'ça': 'that, it',
    'plus': 'more; (with ne) no longer',
    'que': 'that; than; what',
    'lui': 'him, her; to him, to her',
    'mon': 'my',
    'chez': "at the home of, at someone's place",
    'dès': 'from, as early as',
    'soi': 'oneself',
    'moindre': 'lesser, the least',
    'vie': 'life',
    'eau': 'water',
    'vouloir': 'to want',
    'trouver': 'to find',
    'manquer': 'to miss; to lack',
    'madame': 'madam, Mrs',
    'mademoiselle': 'miss',
    'papa': 'dad, daddy',
    'maître': 'master; teacher',
    'garde': 'guard; custody',
    'emmener': 'to take (someone) along',
    'taire': 'to keep quiet; se taire, to fall silent',
    'fleur': 'flower',
    'liberté': 'freedom, liberty',
    'quartier': 'neighbourhood, district',
    'souhaiter': 'to wish',
    'colonel': 'colonel',
    'américain': 'American',
    'crime': 'serious crime, felony',
    'téléphoner': 'to phone, to call',
    'neige': 'snow',
    'costume': 'suit; costume',
    'curieux': 'curious; odd',
    'précis': 'precise, specific',
    'gâteau': 'cake',
    'région': 'region, area',
    'cave': 'cellar, basement',
    'cuir': 'leather',
    'fleuve': 'river (flowing to the sea)',
    'créature': 'creature',
    'évoquer': 'to evoke; to bring up',
    'élevé': 'high; raised',
    'angle': 'angle; corner',
    'décrocher': 'to unhook; to pick up the phone',
    'placard': 'cupboard, closet',
    'usage': 'use, usage',
    'cloche': 'bell',
    'habitant': 'inhabitant, resident',
    'enregistrer': 'to record',
    'évanouir': "s'évanouir, to faint; to vanish",
    'armoire': 'wardrobe, closet',
    'aborder': 'to approach; to broach (a subject)',
    'bouleverser': 'to upset, to turn upside down',
    'province': 'province; the regions outside Paris',
    'régulier': 'regular, steady',
    'damoiseau': 'young nobleman (archaic)',
    'test': 'test',
    'apprêter': 'to prepare, to get ready',
    'bourse': 'purse; grant; stock exchange',
    'pratiquement': 'practically, in practice',
    'écoute': 'listening; wiretapping',
    'impression': 'impression; printing',
    'assurer': 'to assure; to insure; to see to',
    'remonter': 'to go back up; to date back',
    'refaire': 'to redo, to do again',
    'déplacer': 'to move, to shift',
    'disposer': 'to arrange; disposer de, to have at hand',
    'remuer': 'to stir; to move about',
    'déclarer': 'to declare, to state',
    'précipiter': 'to hurl; se précipiter, to rush',
    'déborder': 'to overflow',
    'saint': 'saint; holy',
}

def label(cgram, genre):
    if cgram == 'NOM':
        return {'m': 'n.m.', 'f': 'n.f.'}.get(genre, 'n.')
    if cgram.startswith('PRO'):
        return 'pron.'
    if cgram.startswith('ART'):
        return 'art.'
    if cgram == 'ADJ:num':
        return 'num.'
    if cgram.startswith('ADJ'):
        return 'adj.'
    return {'NOM': 'n.', 'VER': 'v.', 'ADV': 'adv.', 'PRE': 'prep.',
            'CON': 'conj.', 'AUX': 'aux.'}.get(cgram, cgram.lower())

# ---------- rank ----------

def rank_lemmas(path):
    best = {}
    for r in csv.DictReader(open(path, encoding='utf-8'), delimiter='\t'):
        if r['islem'] != '1' or r['cgram'] not in KEEP:
            continue
        lem = r['lemme'].strip()
        if (not lem or ' ' in lem or lem != lem.lower()
                or lem in ELIDED or lem in NOISE or lem in INFLECTED):
            continue
        try:
            films, livres = float(r['freqlemfilms2']), float(r['freqlemlivres'])
        except ValueError:
            continue
        # geometric mean rewards words frequent in BOTH spoken and written French,
        # which is what a four-ability exam tests
        score = math.sqrt((films + 0.1) * (livres + 0.1))
        if lem not in best or score > best[lem]['score']:
            best[lem] = {'lemma': lem, 'score': score, 'films': films, 'livres': livres,
                         'pos': label(r['cgram'], r['genre']), 'ipa': to_ipa(r['phon'])}
    return sorted(best.values(), key=lambda d: -d['score'])

# ---------- gloss ----------

def bucket(p):
    return {'noun': 'n', 'verb': 'v', 'adj': 'adj', 'adv': 'adv', 'prep': 'prep',
            'conj': 'conj', 'pron': 'pron', 'det': 'det', 'article': 'det',
            'num': 'num', 'particle': 'adv', 'intj': 'intj'}.get(p)

def ours(p):
    return {'n.m.': 'n', 'n.f.': 'n', 'n.': 'n', 'v.': 'v', 'aux.': 'v', 'adj.': 'adj',
            'adv.': 'adv', 'prep.': 'prep', 'conj.': 'conj', 'pron.': 'pron',
            'art.': 'det', 'num.': 'num'}.get(p)

PAREN = re.compile(r'\s*\([^)]*\)')
SOFT = ('obsolete', 'archaic', 'dated')
REGISTER = ('vulgar', 'slang', 'colloquial', 'informal')

def tidy(g):
    """Wiktionary writes prose. Keep the first sense, cut at a clause boundary."""
    g = PAREN.sub('', g).strip().rstrip('.').strip()
    g = re.sub(r'\s+', ' ', g)
    if len(g) <= 58:
        return g
    parts = re.split(r',\s+|;\s+', g)
    out = parts[0]
    for p in parts[1:]:
        if len(out) + len(p) + 2 > 58:
            break
        out += ', ' + p
    return out

def collect(entries, pos, tier):
    """tier 0: current, neutral register. 1: allow slang/vulgar. 2: allow dated too.
    Wiktionary tags plenty of live words 'dated' (instituteur, vêtir, putain), so
    tier 2 is what stops a real word being dropped for a tagging quirk."""
    target = ours(pos)
    same = [e for e in entries if bucket(e.get('pos', '')) == target] or entries
    # a POS-matched entry with no usable sense should still fall through to the others
    for group in ([e for e in same], entries):
        gs, tag = [], ''
        for e in group:
            for sense in e.get('senses', []):
                tags = sense.get('tags', [])
                if 'form-of' in tags:
                    continue
                if any(t in SOFT for t in tags) and tier < 2:
                    continue
                reg = [t for t in tags if t in REGISTER]
                if reg and tier < 1:
                    continue
                if reg and not tag:
                    tag = reg[0]
                for g in sense.get('glosses', []):
                    g = tidy(g)
                    if g and g.lower() not in [x.lower() for x in gs]:
                        gs.append(g)
            if gs:
                break
        if gs:
            en = gs[0]
            if len(gs) > 1 and len(en) + len(gs[1]) + 2 <= 62:
                en += '; ' + gs[1]
            return en, tag
    return None, ''

# ---------- main ----------

lexique, kaikki, outpath = sys.argv[1], sys.argv[2], sys.argv[3]
ranked = rank_lemmas(lexique)
pool = ranked[:N + 500]

# Lexique writes "manoeuvre", Wiktionary "manœuvre"; look up under both
key = lambda w: w.replace('œ', 'oe').replace('æ', 'ae')
want = {key(d['lemma']) for d in pool}

found = collections.defaultdict(list)
for line in open(kaikki, encoding='utf-8'):
    if '"word"' not in line:
        continue
    e = json.loads(line)
    if e.get('lang_code') == 'fr' and key(e.get('word', '')) in want:
        found[key(e['word'])].append(e)

out, skipped = [], []
for d in pool:
    if len(out) == N:
        break
    lem = d['lemma']
    tag = ''
    if lem in OVERRIDE:
        en = OVERRIDE[lem]
    else:
        for tier in (0, 1, 2):
            en, tag = collect(found.get(key(lem), []), d['pos'], tier)
            if en:
                break
    if not en or not d['ipa']:
        skipped.append(lem)
        continue
    out.append({'rank': len(out) + 1, 'fr': lem, 'pos': d['pos'], 'en': en,
                'ipa': d['ipa'], 'note': tag})

json.dump({'version': 1, 'source': 'Lexique 3.83 + Wiktionary', 'words': out},
          open(outpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

print(f'wrote {len(out)} words -> {outpath}')
print(f'skipped (no gloss or no IPA): {len(skipped)} {skipped[:12]}')
print('POS mix:', collections.Counter(o['pos'] for o in out).most_common())
print('register-tagged:', collections.Counter(o['note'] for o in out if o['note']).most_common())
print('longest gloss:', max(len(o['en']) for o in out))
bad = [o for o in out if re.search(r'\b(plural|singular|feminine|masculine|participle) of\b', o['en'], re.I)]
print('remaining inflected-form glosses:', len(bad), [o['fr'] for o in bad[:8]])
