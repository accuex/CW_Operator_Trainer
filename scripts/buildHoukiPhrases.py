#!/usr/bin/env python3
"""Publish only curated, verified authored clauses. Never extract/normalize PDFs here."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/1sou_houki/StageH_Final/verified_items.json'
TARGET = ROOT / 'public/houki/data/houki-phrases-v2.json'

def build():
    master = json.loads(SOURCE.read_text())
    assert master['schemaVersion'] == 2
    ids = set()
    for item in master['items']:
        assert item['id'] not in ids
        ids.add(item['id'])
        assert item['verification']['status'] == 'verified'
        assert item['verification']['date'] == master['referenceDate']
        assert item['learningClause'] and item['legalBasis']['article']
        assert len(set(item['options'])) == len(item['options'])
        assert sum(o['correct'] for o in item['optionAssessments']) == 1
        assert next(o['option'] for o in item['optionAssessments'] if o['correct']) == item['answer']
        assert not any(s in item['learningClause'] for s in ['懲役','禁錮','1般','1切','ふく'])
        assert 'sourceStatement' not in item
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(master, ensure_ascii=False, indent=2) + '\n')
    print(f'published {len(ids)} verified items')
if __name__ == '__main__':
    build()
