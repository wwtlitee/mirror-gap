"""Plot raw neutral-odor probe samples; no simulated or illustrative trajectories."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
import numpy as np


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def preference(record, rewarded, window):
    points = record['samples']
    other = 'B' if rewarded == 'A' else 'A'
    samples = [(p['elapsed'], (p['distances'][other] - p['distances'][rewarded]) /
                max(1e-12, p['distances'][other] + p['distances'][rewarded]))
               for p in points if p['elapsed'] >= window[0] - 1e-8]
    integral = sum((a[1] + b[1]) * .5 * (b[0] - a[0])
                   for a, b in zip(samples, samples[1:]))
    return integral / (window[1] - window[0])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('run', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    run = args.run.resolve()
    lock = read(run / 'run-lock.json')
    protocol = lock['protocol']
    seeds = protocol['seeds']
    seconds = protocol['probe']['seconds']
    window = (seconds - protocol['probe']['analysisWindowSeconds'], seconds)
    font_file = Path('C:/Windows/Fonts/msyh.ttc')
    if font_file.exists():
        plt.rcParams['font.family'] = FontProperties(fname=font_file).get_name()
    plt.rcParams.update({'axes.unicode_minus': False, 'font.size': 11,
                         'axes.spines.top': False, 'axes.spines.right': False})
    fig, axes = plt.subplots(2, 2, figsize=(15.4, 10.8))
    fig.patch.set_facecolor('#fcfbf8')
    values = {}
    for col, mapping in enumerate(['native', 'swapped']):
        ax = axes[0, col]
        rows = []
        for index, seed in enumerate(seeds):
            target = 'A' if seed % 2 == 0 else 'B'
            row = {'seed': seed, 'rewarded': target}
            for condition in ['baseline', 'paired', 'unpaired']:
                record = read(run / f'seed-{seed}-{condition}-{mapping}.json')
                row[condition] = preference(record, target, window)
            rows.append(row)
            color = '#117f83' if target == 'A' else '#bd6740'
            offset = (index - (len(seeds) - 1) / 2) * .017
            ax.plot([0 + offset, 1 + offset], [row['baseline'], row['paired']],
                    color=color, alpha=.27, linewidth=1)
            ax.scatter([0 + offset, 1 + offset, 2 + offset],
                       [row['baseline'], row['paired'], row['unpaired']],
                       s=42, color=color, alpha=.82, edgecolors='white', linewidths=.5)
        for x, condition in enumerate(['baseline', 'paired', 'unpaired']):
            average = sum(row[condition] for row in rows) / len(rows)
            ax.plot([x - .17, x + .17], [average, average], color='#192c3a', linewidth=2.5)
        positive = sum(row['paired'] - row['baseline'] > 0 for row in rows)
        absolute = sum(row['paired'] > 0 for row in rows)
        change = sum(row['paired'] - row['baseline'] for row in rows) / len(rows)
        label = '原气味位置' if mapping == 'native' else '互换 A/B 位置'
        ax.set_title(f'{label}：偏好改善 {positive}/{len(seeds)}，训练后正偏好 {absolute}/{len(seeds)}',
                     fontsize=13, pad=14)
        ax.text(.02, .97, f'平均偏好变化 {change:+.3f}；黑横线为均值',
                transform=ax.transAxes, va='top', fontsize=10)
        ax.axhline(0, color='#53636f', linewidth=.8)
        ax.set_ylim(-1.05, 1.05)
        ax.set_xlim(-.4, 2.4)
        ax.set_xticks([0, 1, 2], ['训练前', '实际进食配对后', '等量进食错时组'])
        ax.set_ylabel('末 10 秒相对距离偏好（正值偏向学过气味）')
        ax.grid(axis='y', alpha=.2)
        values[mapping] = rows

        ax = axes[1, col]
        # The first predeclared seed is selected before inspecting trajectories.
        seed = seeds[0]
        target = 'A' if seed % 2 == 0 else 'B'
        for condition, text, color, style in [
            ('baseline', '训练前', '#7f8a91', ':'),
            ('unpaired', '错时对照', '#bd6740', '--'),
            ('paired', '配对训练后', '#117f83', '-')]:
            record = read(run / f'seed-{seed}-{condition}-{mapping}.json')
            xyz = np.array([p['position'] for p in record['samples']])
            ax.plot(xyz[:, 0], xyz[:, 2], style, color=color, linewidth=1.8, label=text)
            ax.scatter(xyz[-1, 0], xyz[-1, 2], color=color, s=28, zorder=4)
            if condition == 'baseline':
                ax.scatter(xyz[0, 0], xyz[0, 2], marker='*', s=150, color='#263e51', zorder=5, label='共同起点')
        for side, source in protocol['cueSources'].items():
            odor = protocol['mappings'][mapping][side]
            x, _, z = source['position']
            ax.scatter(x, z, s=130, marker='D', color='#117f83' if odor == target else '#d4b669', zorder=6)
            ax.annotate(f'气味 {odor}' + ('（学过）' if odor == target else '（未训练）'),
                        (x, z), xytext=(9, 7), textcoords='offset points', fontsize=10)
        ax.set_title(f'预先选定首种子 {seed}：实际身体轨迹，已撤去全部食物', fontsize=12, pad=12)
        ax.set_xlabel('房间 x（米）')
        ax.set_ylabel('房间 z（米）')
        ax.grid(alpha=.18)
        ax.legend(fontsize=9, loc='best')

    fig.suptitle('镜隙 8.3.0｜实际进食改变突触后，撤去食物检验中性气味偏好',
                 fontsize=19, fontweight='bold', y=.985)
    fig.text(.5, .035,
             f'同一连接组的 {len(seeds)} 个独立原脑种子；两位置映射复用样本。'
             '探测无食物、无教学、冻结突触，原觅食系统开启。',
             ha='center', fontsize=11)
    fig.text(.5, .012,
             '青色点：A 受奖训练；橙色点：B 受奖训练。另一气味在训练中未呈现；偏好改善不等于每个样本均追到气味源。',
             ha='center', fontsize=10, color='#607078')
    fig.tight_layout(rect=(.015, .06, .985, .955), h_pad=2.6, w_pad=2)
    output = args.out or (run / 'neutral-behavior-summary-8.3.0.png')
    if output.exists():
        raise FileExistsError('Do not overwrite a delivered figure: ' + str(output))
    fig.savefig(output, dpi=160, facecolor=fig.get_facecolor())
    output.with_suffix('.data.json').write_text(json.dumps({
        'version': '8.3.0', 'sourceRun': str(run), 'independentSeeds': seeds,
        'windowSeconds': window, 'trajectorySeedChosenInAdvance': seeds[0], 'metrics': values,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(output)


if __name__ == '__main__':
    main()
