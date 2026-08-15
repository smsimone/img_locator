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

  function extractTargetSubject(image) {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = image.width;
    sourceCanvas.height = image.height;
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    sourceCtx.drawImage(image, 0, 0);

    const imageData = sourceCtx.getImageData(0, 0, image.width, image.height).data;
    const borderStats = {
      count: 0,
      r: 0,
      g: 0,
      b: 0,
      r2: 0,
      g2: 0,
      b2: 0,
    };

    function collectBorderPixel(x, y) {
      const i = (y * image.width + x) * 4;
      const alpha = imageData[i + 3];
      if (alpha < 16) {
        return;
      }
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];
      borderStats.count++;
      borderStats.r += r;
      borderStats.g += g;
      borderStats.b += b;
      borderStats.r2 += r * r;
      borderStats.g2 += g * g;
      borderStats.b2 += b * b;
    }

    for (let x = 0; x < image.width; x++) {
      collectBorderPixel(x, 0);
      collectBorderPixel(x, image.height - 1);
    }
    for (let y = 1; y < image.height - 1; y++) {
      collectBorderPixel(0, y);
      collectBorderPixel(image.width - 1, y);
    }

    if (!borderStats.count) {
      return { source: image, extracted: false };
    }

    const meanR = borderStats.r / borderStats.count;
    const meanG = borderStats.g / borderStats.count;
    const meanB = borderStats.b / borderStats.count;
    const varR = Math.max(0, borderStats.r2 / borderStats.count - meanR * meanR);
    const varG = Math.max(0, borderStats.g2 / borderStats.count - meanG * meanG);
    const varB = Math.max(0, borderStats.b2 / borderStats.count - meanB * meanB);
    const bgDeviation = Math.sqrt(varR + varG + varB);
    const colorThreshold = Math.max(35, bgDeviation * 2.2);

    let minX = image.width;
    let minY = image.height;
    let maxX = -1;
    let maxY = -1;
    let subjectPixels = 0;

    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        const alpha = imageData[i + 3];
        if (alpha < 16) {
          continue;
        }

        let isSubject = alpha < 245;
        if (!isSubject) {
          const dr = imageData[i] - meanR;
          const dg = imageData[i + 1] - meanG;
          const db = imageData[i + 2] - meanB;
          const distance = Math.sqrt(dr * dr + dg * dg + db * db);
          isSubject = distance > colorThreshold;
        }

        if (!isSubject) {
          continue;
        }

        subjectPixels++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (subjectPixels < 24 || maxX < minX || maxY < minY) {
      return { source: image, extracted: false };
    }

    const coverage = subjectPixels / (image.width * image.height);
    if (coverage > 0.95) {
      return { source: image, extracted: false };
    }

    const padX = Math.max(2, Math.round((maxX - minX + 1) * 0.06));
    const padY = Math.max(2, Math.round((maxY - minY + 1) * 0.06));
    const cropX = Math.max(0, minX - padX);
    const cropY = Math.max(0, minY - padY);
    const cropW = Math.min(image.width - cropX, maxX - minX + 1 + padX * 2);
    const cropH = Math.min(image.height - cropY, maxY - minY + 1 + padY * 2);

    if (cropW >= image.width * 0.98 && cropH >= image.height * 0.98) {
      return { source: image, extracted: false };
    }

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const croppedCtx = croppedCanvas.getContext('2d');
    croppedCtx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    return { source: croppedCanvas, extracted: true };
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
      const extractedTarget = extractTargetSubject(image);
      const targetSource = extractedTarget.source;
      const targetWork = imageToWorkData(targetSource, MAX_TARGET_SIDE);
      const previewSize = fitSize(targetSource.width, targetSource.height, 240);

      targetCanvas.width = previewSize.width;
      targetCanvas.height = previewSize.height;
      targetCtx.drawImage(targetSource, 0, 0, previewSize.width, previewSize.height);

      const match = findBestMatch(state.refWork, targetWork);

      if (!match) {
        setStatus('Target troppo grande rispetto alla reference.');
        return;
      }

      drawReferenceWithCircle(match, targetWork);
      const extractionPrefix = extractedTarget.extracted ? 'Soggetto estratto. ' : '';
      setStatus(`${extractionPrefix}Posizione trovata (score medio: ${match.score.toFixed(2)}).`);
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
