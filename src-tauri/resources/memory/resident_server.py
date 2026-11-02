"""App-owned serialized MLX server. Resident weights, independent session state."""
import json
import os
from pathlib import Path
import socket
import sys

def serve(kind, address):
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    from huggingface_hub import snapshot_download
    import mlx.core as mx
    if kind == 'speech':
        import numpy as np
        import live_speech, transcribe, voice_profiles
        from resemblyzer import VoiceEncoder
        if live_speech.engine() == 'moss':
            from mlx_audio.stt import load
            model = load(snapshot_download(transcribe.MODEL, revision=transcribe.REVISION, local_files_only=True))
            model.generate(np.zeros(16000, dtype='float32'), max_tokens=32, temperature=0.0)
            model._memoria_warmed = True
            loaded = model
        else:
            import streaming_speech
            loaded = streaming_speech.load()
            streaming_speech.warm(loaded)
            loaded[0]._memoria_warmed = True
        voice_profiles._encoder = VoiceEncoder(device='cpu', verbose=False)
    else:
        from mlx_vlm.embedding_loader import load_embedding_model
        from transformers import AutoTokenizer
        import embeddings
        path = snapshot_download('mlx-community/embeddinggemma-2-5bit', local_files_only=True,
                                 allow_patterns=['*.json', '*.safetensors', '*.jinja', '*.model'])
        model = load_embedding_model(Path(path))
        tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)
        batch = tokenizer(['search_query: readiness'], return_tensors='np')
        mx.eval(model(**{k: mx.array(v) for k, v in batch.items()}).text_embeds)
        loaded = (model, tokenizer, path)
    server = socket.socket(socket.AF_UNIX)
    server.bind(address); Path(address).chmod(0o600); server.listen(4)
    from worker_lifetime import exit_with_parent
    exit_with_parent(address)
    print(json.dumps({'ready': kind, 'pid': os.getpid(), 'mlxBytes': mx.get_active_memory()}), flush=True)
    original_input, original_output = sys.stdin, sys.stdout
    try:
        while True:
            connection, _ = server.accept()
            with connection:
                reader = connection.makefile('r')
                writer = connection.makefile('w', buffering=1)
                try:
                    operation = json.loads(reader.readline())['operation']
                    sys.stdin, sys.stdout = reader, writer
                    if kind == 'speech' and operation == 'live': live_speech.run(loaded)
                    elif kind == 'speech' and operation == 'transcribe':
                        print(json.dumps({'result': transcribe.run(json.loads(reader.readline()), loaded)}), flush=True)
                    elif kind == 'embed' and operation == 'embed': embeddings.main(loaded)
                    else: raise ValueError('Unsupported resident operation')
                except Exception as error:
                    try: print(json.dumps({'error': str(error)}), flush=True)
                    except OSError: pass
                finally:
                    sys.stdin, sys.stdout = original_input, original_output
                    try: reader.close(); writer.close()
                    except OSError: pass
    finally:
        server.close(); Path(address).unlink(missing_ok=True)

if __name__ == '__main__':
    try: serve(sys.argv[1], sys.argv[2])
    except Exception as error:
        print(json.dumps({'error': str(error)}), flush=True); sys.exit(1)
