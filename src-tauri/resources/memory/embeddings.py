"""Local-only embedding adapter; invoked with the isolated embedding Python."""
import json
import sys
from pathlib import Path

def main(loaded=None):
    import mlx.core as mx
    import numpy as np
    from huggingface_hub import snapshot_download
    from mlx_vlm.embedding_loader import load_embedding_model
    from transformers import AutoTokenizer
    request = json.load(sys.stdin)
    if loaded:
        model, tokenizer, path = loaded
    else:
        path = snapshot_download('mlx-community/embeddinggemma-2-5bit', local_files_only=True,
            allow_patterns=['*.json', '*.safetensors', '*.jinja', '*.model'])
        model = load_embedding_model(Path(path))
        tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)
    vectors = []
    for offset in range(0, len(request['texts']), 4):
        texts = request['texts'][offset:offset + 4]
        batch = tokenizer(texts, padding=True, truncation=False, return_tensors='np')
        if batch['input_ids'].shape[1] > 8192:
            raise ValueError('Embedding input exceeds model context')
        output = model(**{key: mx.array(value) for key, value in batch.items()}).text_embeds
        mx.eval(output)
        values = np.asarray(output.astype(mx.float32))
        values /= np.maximum(np.linalg.norm(values, axis=1, keepdims=True), 1e-12)
        if not np.isfinite(values).all():
            raise ValueError('Embedding contains non-finite values')
        vectors.extend(values.tolist())
    print(json.dumps({'vectors': vectors, 'revision': path.rsplit('/', 1)[-1]}))

if __name__ == '__main__':
    try:
        import os
        if os.environ.get('MEMORIA_EMBED_SOCKET'):
            from resident_client import relay
            relay(os.environ['MEMORIA_EMBED_SOCKET'], 'embed')
        else: main()
    except Exception as error:
        print(json.dumps({'error': str(error)}))
