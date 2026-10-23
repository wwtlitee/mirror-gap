"""Fit the declared engineering decoder; never changes the biological edge weights."""
import json
from pathlib import Path
import numpy as np

home = Path(__file__).resolve().parents[1]
samples = json.loads((home / 'runtime/functional-calibration-samples.json').read_text(encoding='utf-8'))['results']
y = np.array([row['rates'] for row in samples])
baseline = y[0]
response = np.array([(y[2*c+2]-y[2*c+1])/.55 for c in range(4)]).T
if np.linalg.matrix_rank(response) < 4:
    raise ValueError('Named motor responses do not resolve four projected channels')
inverse = np.linalg.pinv(response, rcond=.02)
holdout = [{'input': row['inputs'][:4], 'decoded': (.34+inverse@(y[i]-baseline)).tolist()}
           for i, row in enumerate(samples) if i >= 9]
artifact = {'version':'4.0.0', 'graphHash':(home/'src/functional-connectome.sha256').read_text().strip(),
            'baseline':baseline.tolist(), 'inverse':inverse.tolist(), 'response':response.tolist(),
            'provenance':'Named PFL/descending motor populations only. Two fixed seeds, 100 neural ms warmup + 300 ms observation per case. Engineering decoding, not biological 3D motor labels.'}
(home/'src/functional-calibration.json').write_text(json.dumps(artifact,indent=2)+'\n',encoding='utf-8')
(home/'runtime/functional-calibration-holdout.json').write_text(json.dumps(holdout,indent=2)+'\n',encoding='utf-8')
print(json.dumps(holdout))
