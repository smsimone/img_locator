(() => {
  const MAX_REFERENCE_SIDE = 320;
  const MAX_TARGET_SIDE = 120;

  const $referenceInput = $('#referenceInput');
  const $referenceUrlInput = $('#referenceUrlInput');
  const $loadReferenceUrlButton = $('#loadReferenceUrlButton');
  const $targetInput = $('#targetInput');
  const $status = $('#status');

  const referenceCanvas = document.getElementById('referenceCanvas');
  const targetCanvas = document.getElementById('targetCanvas');
  const refCtx = referenceCanvas.getContext('2d');
  const targetCtx = targetCanvas.getContext('2d');

  const state = {
    referenceImage: null,
    refDisplayScale: 1,
    refWork: null,
  };

  function setStatus(message) {
    $status.text(message);
  }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Immagine non valida.'));
      };
      image.src = url;
    });
  }

  function readImageFromUrl(rawUrl) {
    return new Promise((resolve, reject) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(rawUrl);
      } catch {
        reject(new Error('URL non valida.'));
        return;
      }

      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Impossibile caricare l\'immagine da URL.'));
      image.src = parsedUrl.toString();
    });
  }

  function fitSize(width, height, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      scale,
    };
  }

  function imageToWorkData(image, maxSide) {
    const size = fitSize(image.width, image.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, size.width, size.height);
    const rgba = ctx.getImageData(0, 0, size.width, size.height).data;
    const gray = new Float32Array(size.width * size.height);

    for (let i = 0, g = 0; i < rgba.length; i += 4, g++) {
      gray[g] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }

    return { width: size.width, height: size.height, gray };
  }

  function findBestMatch(reference, target) {
    if (target.width > reference.width || target.height > reference.height) {
      return null;
    }

    let bestError = Number.POSITIVE_INFINITY;
    let bestX = 0;
    let bestY = 0;

    for (let y = 0; y <= reference.height - target.height; y++) {
      for (let x = 0; x <= reference.width - target.width; x++) {
        let error = 0;

        for (let ty = 0; ty < target.height; ty++) {
          const refRow = (y + ty) * reference.width;
          const targetRow = ty * target.width;

          for (let tx = 0; tx < target.width; tx++) {
            const diff = reference.gray[refRow + (x + tx)] - target.gray[targetRow + tx];
            error += Math.abs(diff);
          }
        }

        if (error < bestError) {
          bestError = error;
          bestX = x;
          bestY = y;
        }
      }
    }

    return {
      x: bestX,
      y: bestY,
      score: bestError / (target.width * target.height),
    };
  }

  function drawReferenceWithCircle(match, targetWork) {
    refCtx.clearRect(0, 0, referenceCanvas.width, referenceCanvas.height);
    refCtx.drawImage(state.referenceImage, 0, 0, referenceCanvas.width, referenceCanvas.height);

    const scale = state.refDisplayScale;
    const cx = (match.x + targetWork.width / 2) * scale;
    const cy = (match.y + targetWork.height / 2) * scale;
    const radius = (Math.max(targetWork.width, targetWork.height) * scale) / 2;

    refCtx.lineWidth = 4;
    refCtx.strokeStyle = '#f73131';
    refCtx.beginPath();
    refCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    refCtx.stroke();
  }

  function applyReference(image) {
    const displaySize = fitSize(image.width, image.height, 900);

    state.referenceImage = image;
    state.refDisplayScale = displaySize.width / image.width;
    state.refWork = imageToWorkData(image, MAX_REFERENCE_SIDE);

    referenceCanvas.width = displaySize.width;
    referenceCanvas.height = displaySize.height;
    refCtx.drawImage(image, 0, 0, displaySize.width, displaySize.height);

    targetCanvas.width = 1;
    targetCanvas.height = 1;
    targetCtx.clearRect(0, 0, 1, 1);

    $targetInput.prop('disabled', false).val('');
    setStatus('Reference caricata. Ora scegli un target.');
  }

  async function handleReferenceChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const image = await readImage(file);
      applyReference(image);
    } catch {
      setStatus('Errore nel caricamento della reference.');
    }
  }

  async function handleReferenceUrlLoad() {
    const url = $referenceUrlInput.val()?.toString().trim();
    if (!url) {
      setStatus('Inserisci un URL prima di caricare la reference.');
      return;
    }

    setStatus('Caricamento reference da URL...');
    try {
      const image = await readImageFromUrl(url);
      applyReference(image);
    } catch {
      setStatus('Errore nel caricamento via URL (verifica che il server permetta CORS).');
    }
  }

  async function handleTargetChange(event) {
    const file = event.target.files?.[0];
    if (!file || !state.refWork || !state.referenceImage) {
      return;
    }

    setStatus('Ricerca posizione target in corso...');

    try {
      const image = await readImage(file);
      const targetWork = imageToWorkData(image, MAX_TARGET_SIDE);
      const previewSize = fitSize(image.width, image.height, 240);

      targetCanvas.width = previewSize.width;
      targetCanvas.height = previewSize.height;
      targetCtx.drawImage(image, 0, 0, previewSize.width, previewSize.height);

      const match = findBestMatch(state.refWork, targetWork);

      if (!match) {
        setStatus('Target troppo grande rispetto alla reference.');
        return;
      }

      drawReferenceWithCircle(match, targetWork);
      setStatus(`Posizione trovata (score medio: ${match.score.toFixed(2)}).`);
    } catch {
      setStatus('Errore nel caricamento del target.');
    }
  }

  $referenceInput.on('change', handleReferenceChange);
  $loadReferenceUrlButton.on('click', handleReferenceUrlLoad);
  $referenceUrlInput.on('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleReferenceUrlLoad();
    }
  });
  $targetInput.on('change', handleTargetChange);
})();
