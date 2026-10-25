import { useEffect, useRef, useState } from 'react';
import type { BlazeFaceModel } from '@tensorflow-models/blazeface';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export type BlazeFaceModelState =
  | {
      readonly status: Exclude<ModelStatus, 'ready'>;
      readonly model: null;
    }
  | { readonly status: 'ready'; readonly model: BlazeFaceModel };

interface ModelSnapshot {
  readonly model: BlazeFaceModel | null;
  readonly hasFailed: boolean;
}

const EMPTY_SNAPSHOT: ModelSnapshot = { model: null, hasFailed: false };

/** TensorFlow.js dimuat malas agar tidak membebani bundel awal. */
const loadBlazeFaceModel = async (): Promise<BlazeFaceModel> => {
  const [blazeface, tf] = await Promise.all([
    import('@tensorflow-models/blazeface'),
    import('@tensorflow/tfjs-core'),
  ]);
  await import('@tensorflow/tfjs-backend-webgl');
  await tf.setBackend('webgl');
  await tf.ready();

  // Ambang internal diturunkan ke 0.5 agar wajah ber-keyakinan tertahan (0.55–0.78,
  // indikasi masker) tetap diteruskan; gerbang validasi ketat 0.8 ada di faceValidation.ts.
  return blazeface.load({ maxFaces: 1, scoreThreshold: 0.5 });
};

/**
 * Memuat model BlazeFace saat pertama kali dibutuhkan (`shouldLoad`), menyimpannya
 * selama komponen hidup, dan membebaskan memori WebGL-nya saat unmount.
 */
export function useBlazeFaceModel(shouldLoad: boolean): BlazeFaceModelState {
  const [snapshot, setSnapshot] = useState<ModelSnapshot>(EMPTY_SNAPSHOT);
  const pendingModelRef = useRef<Promise<BlazeFaceModel> | null>(null);

  useEffect(() => {
    if (!shouldLoad) {
      return undefined;
    }

    if (pendingModelRef.current === null) {
      const pending = loadBlazeFaceModel();
      pendingModelRef.current = pending;

      // Hasil hanya dipakai jika model ini masih dimiliki hook (belum di-unmount).
      pending.then(
        (model) => {
          if (pendingModelRef.current === pending) {
            setSnapshot({ model, hasFailed: false });
          }
        },
        (error: unknown) => {
          if (pendingModelRef.current !== pending) {
            return;
          }

          pendingModelRef.current = null;
          console.error('Gagal memuat model BlazeFace:', error);
          setSnapshot({ model: null, hasFailed: true });
        },
      );
    }

    // Kegagalan dilupakan saat dinonaktifkan agar permintaan berikutnya mencoba lagi.
    return () => {
      setSnapshot((current) =>
        current.hasFailed ? EMPTY_SNAPSHOT : current,
      );
    };
  }, [shouldLoad]);

  useEffect(
    () => () => {
      const pending = pendingModelRef.current;
      pendingModelRef.current = null;
      void pending?.then(
        (model) => model.dispose(),
        () => undefined,
      );
    },
    [],
  );

  if (snapshot.model) {
    return { status: 'ready', model: snapshot.model };
  }

  if (snapshot.hasFailed) {
    return { status: 'error', model: null };
  }

  return { status: shouldLoad ? 'loading' : 'idle', model: null };
}
