"""Build a bounded functional graph from the reviewed full-data candidates."""
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix

HOME = Path(__file__).resolve().parents[1]
ROOT = HOME.parent
spec = importlib.util.spec_from_file_location('selector', ROOT / 'experiments/circuit_selection/select_circuits.py')
selector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selector)
a = pd.read_csv(ROOT / 'data/flywire_v783/annotations_3.1.0/Supplemental_file1_neuron_annotations.tsv', sep='\t', dtype=str).fillna('')
ids = pd.read_csv(ROOT / 'sources/Drosophila_brain_model/Completeness_783.csv', index_col=0).index.to_numpy(dtype=np.uint64)
official = set(map(str, np.load(ROOT / 'data/flywire_v783/proofread_root_ids_783.npy')))
ix = {str(root): i for i, root in enumerate(ids) if str(root) in official}
author, _ = selector.notebook_ids(ROOT / 'sources/Drosophila_brain_model')


def typed(names, side=None):
    rows = a[a.cell_type.isin(names)]
    if side:
        rows = rows[rows.side == side]
    return {ix[r] for r in rows.root_id if r in ix}


def named(*names):
    return {ix[r] for name in names for r in author[name] if r in ix}


channels = [typed(['EPG'], 'left'), typed(['EPG'], 'right'),
            typed(['FC2A', 'FC2B', 'FC2C'], 'left'), typed(['FC2A', 'FC2B', 'FC2C'], 'right'),
            named('neu_sugar', 'neu_sugar_left'), named('neu_water'),
            named('neu_JON_CE', 'neu_JON_F', 'neu_JON_D_m'),
            typed(['LC4', 'LPLC2'], 'left'), typed(['LC4', 'LPLC2'], 'right')]
output_types = ['PFL3', 'PFL2', 'DNa01', 'DNa02', 'DNg13', 'DNa03', 'DNa04', 'DNa15', 'DNb01', 'DNg07', 'DNp20', 'DNp01', 'DNp07', 'DNp10', 'MDN', 'DNp09']
outputs = typed(output_types) | named('id_mn9', 'id_DN1_1', 'id_DN2_l', 'id_aBN1')
anchors = set.union(*channels) | outputs | typed(['ER5', 'ExR1', 'ExR3', 'hDeltaK', 's-LNv_a', 's-LNv_b', 'l-LNv'])
frame = pd.read_parquet(ROOT / 'sources/Drosophila_brain_model/Connectivity_783.parquet', columns=['Presynaptic_Index', 'Postsynaptic_Index', 'Excitatory x Connectivity'])
pre, post, weights = [frame.iloc[:, i].to_numpy(dtype=np.int32) for i in range(3)]
valid_ids = np.array([str(r) in official for r in ids])
valid = valid_ids[pre] & valid_ids[post] & (weights != 0)
graph = csr_matrix((np.ones(valid.sum(), dtype=np.int32), (pre[valid], post[valid])), shape=(len(ids), len(ids)))
selected = set(anchors)
routes = [(set.union(*channels[:4], *channels[7:]), outputs, 2),
          (channels[4] | channels[5] | named('neu_bitter', 'neu_ir94e'), named('id_mn9'), 3),
          (channels[6], named('id_DN1_1', 'id_DN2_l'), 3)]
for inputs, targets, hops in routes:
    selected.update(map(int, selector.path_members(graph, inputs, targets, hops)[0]))
selection = np.array(sorted(selected), dtype=np.int32)
mask = np.zeros(len(ids), dtype=bool)
mask[selection] = True
edges = valid & mask[pre] & mask[post]
mapping = {int(old): new for new, old in enumerate(selection)}
by_root = a.set_index('root_id')
labels = []
for old in selection:
    row = by_root.loc[str(ids[old])] if str(ids[old]) in by_root.index else {}
    labels.append({'root': str(ids[old]), 'type': row.get('cell_type', ''), 'side': row.get('side', ''), 'anchor': int(old) in anchors})
model = {'version': '4.0.0', 'selection': 'functional-paths-v1', 'neurons': len(selection), 'dt_ms': .1,
         'channels': [[mapping[i] for i in sorted(group)] for group in channels],
         'channelNames': ['heading-left', 'heading-right', 'goal-left', 'goal-right', 'sugar', 'water', 'antennal-touch', 'looming-left', 'looming-right'],
         'motorIndices': [mapping[i] for i in sorted(typed(output_types))],
         'behaviorIndices': {name: [mapping[i] for i in sorted(named(*names))] for name, names in
                             [('feeding', ['id_mn9']), ('grooming', ['id_DN1_1', 'id_DN2_l'])]},
         'labels': labels, 'pre': [mapping[int(i)] for i in pre[edges]],
         'post': [mapping[int(i)] for i in post[edges]], 'weights': weights[edges].tolist(),
         'provenance': {'annotation': 'v3.1.0 / FlyWire 783', 'candidateReport': selector.digest(ROOT / 'experiments/circuit_selection/output/report.json'),
                        'authorConnectivity': selector.digest(ROOT / 'sources/Drosophila_brain_model/Connectivity_783.parquet'),
                        'mapping': 'Heading/goal population stimulation and 3D motor decoding are engineering approximations; no complete-brain claim.'}}
path = HOME / 'src/functional-connectome.json'
raw = json.dumps(model, separators=(',', ':')).encode()
path.write_bytes(raw)
(HOME / 'src/functional-connectome.sha256').write_text(hashlib.sha256(raw).hexdigest()+'\n', encoding='utf-8')
# Bounded display sampling; never download the whole runtime graph to render the brain.
sample = np.linspace(0, len(selection)-1, min(1024, len(selection)), dtype=int)
sample_set = set(sample.tolist())
display_edges = [(p, q) for p, q in zip(model['pre'], model['post']) if p in sample_set and q in sample_set][:1600]
(HOME / 'public/assets/functional-brain-view.json').write_text(json.dumps({'neurons': model['neurons'], 'sample': sample.tolist(), 'pre': [e[0] for e in display_edges], 'post': [e[1] for e in display_edges]}), encoding='utf-8')
print(json.dumps({'neurons': model['neurons'], 'edges': len(model['pre']), 'channels': list(map(len,model['channels'])), 'outputs': len(model['motorIndices'])}))
