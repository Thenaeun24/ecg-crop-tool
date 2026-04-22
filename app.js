(function () {
  'use strict';

  // ============ State ============
  let cropper = null;
  let croppedCanvas = null;

  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragBoxStartX = 0;
  let dragBoxStartY = 0;

  let isResizing = false;
  let resizeDir = '';
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartW = 0;
  let resizeStartH = 0;
  let resizeStartLeft = 0;
  let resizeStartTop = 0;

  let highlightMode = false;
  let highlightBoxes = [];
  let isDrawingHighlight = false;
  let hlStartX = 0;
  let hlStartY = 0;
  let currentHlEl = null;

  let isDraggingHl = false;
  let draggingHlEl = null;
  let hlDragOffsetX = 0;
  let hlDragOffsetY = 0;
  let isResizingHl = false;
  let resizingHlEl = null;
  let hlResizeEdge = '';
  let hlResizeStartMouseX = 0;
  let hlResizeStartMouseY = 0;
  let hlResizeOrigLeft = 0;
  let hlResizeOrigTop = 0;
  let hlResizeOrigW = 0;
  let hlResizeOrigH = 0;
  let lastHlActionTime = 0;

  let baseBoxWidth = 0;
  const BASE_FONT_SIZE = 14;

  const RHYTHM_OPTIONS = [
    '최초 리듬', '2차 분석 리듬', '이송중 리듬', '병원 도착 전 리듬', '제세동 리듬'
  ];

  const PDF_RENDER_SCALE = 2.5;

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // ============ Helpers ============
  const $ = (sel) => document.querySelector(sel);

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ============ Init ============
  document.addEventListener('DOMContentLoaded', function () {
    setupUpload();
    setupForm();
    setupButtons();
  });

  function showSection(id) {
    ['upload-section', 'edit-section', 'preview-section'].forEach(function (s) {
      $('#' + s).style.display = (s === id) ? '' : 'none';
    });
  }

  // ============ Upload ============
  function setupUpload() {
    var dropZone = $('#drop-zone');
    var fileInput = $('#file-input');
    var fileBtn = $('#file-btn');

    fileBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      fileInput.click();
    });

    dropZone.addEventListener('click', function (e) {
      if (e.target === fileBtn) return;
      fileInput.click();
    });

    fileInput.addEventListener('change', function (e) {
      if (e.target.files.length > 0) handleFile(e.target.files[0]);
    });

    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', function () {
      dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
  }

  function handleFile(file) {
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

    if (isPdf) {
      if (typeof pdfjsLib === 'undefined') {
        alert('PDF 라이브러리를 불러오지 못했습니다. 네트워크 연결을 확인해주세요.');
        return;
      }
      $('#drop-zone').style.display = 'none';
      $('#loading').style.display = '';
      processPdf(file);
      return;
    }

    if (!file.type.startsWith('image/')) {
      alert('이미지 또는 PDF 파일만 업로드할 수 있습니다. (JPG, PNG, PDF)');
      return;
    }

    $('#drop-zone').style.display = 'none';
    $('#loading').style.display = '';

    processImage(file);
  }

  // ============ PDF Processing ============
  function processPdf(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var data = new Uint8Array(e.target.result);
      pdfjsLib.getDocument({ data: data }).promise.then(function (pdf) {
        if (pdf.numPages <= 1) {
          renderPdfPage(pdf, 1);
        } else {
          showPdfPageSelector(pdf);
        }
      }).catch(function (err) {
        console.error(err);
        alert('PDF를 불러올 수 없습니다.');
        resetUpload();
      });
    };
    reader.onerror = function () {
      alert('파일을 읽을 수 없습니다.');
      resetUpload();
    };
    reader.readAsArrayBuffer(file);
  }

  function showPdfPageSelector(pdf) {
    var modal = $('#pdf-page-modal');
    var select = $('#pdf-page-select');
    select.innerHTML = '';
    for (var i = 1; i <= pdf.numPages; i++) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = i + ' / ' + pdf.numPages + ' 페이지';
      select.appendChild(opt);
    }
    modal.style.display = '';

    function onOk() {
      var pageNum = parseInt(select.value, 10) || 1;
      modal.style.display = 'none';
      cleanup();
      renderPdfPage(pdf, pageNum);
    }
    function onCancel() {
      modal.style.display = 'none';
      cleanup();
      resetUpload();
    }
    function cleanup() {
      $('#pdf-page-ok-btn').removeEventListener('click', onOk);
      $('#pdf-page-cancel-btn').removeEventListener('click', onCancel);
    }
    $('#pdf-page-ok-btn').addEventListener('click', onOk);
    $('#pdf-page-cancel-btn').addEventListener('click', onCancel);
  }

  function renderPdfPage(pdf, pageNum) {
    pdf.getPage(pageNum).then(function (page) {
      var viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      var ctx = canvas.getContext('2d');
      // PDF can have transparent background; fill white so JPEG export looks right
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        if (canvas.height > canvas.width) {
          showRotationModal(canvas);
        } else {
          showEditSection(canvas.toDataURL('image/jpeg', 0.92));
        }
      }).catch(function (err) {
        console.error(err);
        alert('PDF 페이지를 렌더링할 수 없습니다.');
        resetUpload();
      });
    }).catch(function (err) {
      console.error(err);
      alert('PDF 페이지를 불러올 수 없습니다.');
      resetUpload();
    });
  }

  // ============ EXIF Orientation (manual parser, no library needed) ============
  function getExifOrientation(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var view = new DataView(e.target.result);
          if (view.byteLength < 4 || view.getUint16(0, false) !== 0xFFD8) {
            resolve(0);
            return;
          }
          var offset = 2;
          var length = view.byteLength;
          while (offset < length - 4) {
            var marker = view.getUint16(offset, false);
            offset += 2;
            if (marker === 0xFFE1) {
              if (offset + 8 > length) { resolve(0); return; }
              var exifId = view.getUint32(offset + 2, false);
              if (exifId === 0x45786966) {
                var tiffStart = offset + 8;
                if (tiffStart + 8 > length) { resolve(0); return; }
                var little = view.getUint16(tiffStart, false) === 0x4949;
                var ifdOffset = view.getUint32(tiffStart + 4, little);
                var ifdStart = tiffStart + ifdOffset;
                if (ifdStart + 2 > length) { resolve(0); return; }
                var numEntries = view.getUint16(ifdStart, little);
                for (var i = 0; i < numEntries; i++) {
                  var entryOffset = ifdStart + 2 + i * 12;
                  if (entryOffset + 12 > length) break;
                  if (view.getUint16(entryOffset, little) === 0x0112) {
                    resolve(view.getUint16(entryOffset + 8, little));
                    return;
                  }
                }
              }
              resolve(0);
              return;
            } else if ((marker & 0xFF00) === 0xFF00) {
              if (marker === 0xFFDA) break;
              if (offset + 2 > length) break;
              offset += view.getUint16(offset, false);
            } else {
              break;
            }
          }
        } catch (ex) { /* ignore parse errors */ }
        resolve(0);
      };
      reader.onerror = function () { resolve(0); };
      reader.readAsArrayBuffer(file.slice(0, 65536));
    });
  }

  function exifOrientationToDegrees(orientation) {
    switch (orientation) {
      case 3: return 180;
      case 6: return 90;
      case 8: return 270;
      default: return 0;
    }
  }

  // ============ Image Processing ============
  function rotateCanvas(source, degrees) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var rad = degrees * Math.PI / 180;

    if (degrees === 90 || degrees === 270) {
      canvas.width = source.height;
      canvas.height = source.width;
    } else {
      canvas.width = source.width;
      canvas.height = source.height;
    }

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    return canvas;
  }

  function processImage(file) {
    getExifOrientation(file).then(function (orientation) {
      var degrees = exifOrientationToDegrees(orientation);
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);

          if (degrees !== 0) {
            canvas = rotateCanvas(canvas, degrees);
            showEditSection(canvas.toDataURL('image/jpeg', 0.92));
          } else if (img.height > img.width) {
            showRotationModal(canvas);
          } else {
            showEditSection(canvas.toDataURL('image/jpeg', 0.92));
          }
        };
        img.onerror = function () {
          alert('이미지를 불러올 수 없습니다.');
          resetUpload();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function showRotationModal(canvas) {
    var modal = $('#rotation-modal');
    modal.style.display = '';

    function onYes() {
      modal.style.display = 'none';
      var rotated = rotateCanvas(canvas, 270);
      showEditSection(rotated.toDataURL('image/jpeg', 0.92));
      cleanup();
    }

    function onNo() {
      modal.style.display = 'none';
      showEditSection(canvas.toDataURL('image/jpeg', 0.92));
      cleanup();
    }

    function cleanup() {
      $('#rotate-yes-btn').removeEventListener('click', onYes);
      $('#rotate-no-btn').removeEventListener('click', onNo);
    }

    $('#rotate-yes-btn').addEventListener('click', onYes);
    $('#rotate-no-btn').addEventListener('click', onNo);
  }

  // ============ Edit Section ============
  function showEditSection(dataURL) {
    $('#loading').style.display = 'none';
    showSection('edit-section');

    var cropImage = $('#crop-image');
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }

    cropImage.onload = function () {
      cropper = new Cropper(cropImage, {
        viewMode: 1,
        dragMode: 'crop',
        autoCrop: false,
        responsive: true,
        restore: false,
        guides: true,
        center: true,
        highlight: true,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        background: true
      });
    };
    cropImage.src = dataURL;
  }

  function resetUpload() {
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }
    croppedCanvas = null;
    clearHighlightBoxes();
    $('#file-input').value = '';
    $('#drop-zone').style.display = '';
    $('#loading').style.display = 'none';
    showSection('upload-section');
  }

  function resetAll() {
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }
    croppedCanvas = null;
    clearHighlightBoxes();

    $('#patient-name').value = '';
    $('#patient-gender').selectedIndex = 0;
    $('#patient-age').value = '';
    $('#patient-cc').value = '';
    $('#extra-select').selectedIndex = 0;
    $('#rhythm-select').selectedIndex = 0;
    $('#rhythm-group').style.display = 'none';

    $('#file-input').value = '';
    $('#drop-zone').style.display = '';
    $('#loading').style.display = 'none';
    $('#preview-image').src = '';

    highlightMode = false;
    var hlBtn = $('#highlight-box-btn');
    if (hlBtn) hlBtn.style.backgroundColor = '#EF4444';

    showSection('upload-section');
  }

  // ============ Form ============
  function setupForm() {
    var extraSelect = $('#extra-select');
    var rhythmGroup = $('#rhythm-group');

    extraSelect.addEventListener('change', function () {
      rhythmGroup.style.display = RHYTHM_OPTIONS.includes(extraSelect.value) ? '' : 'none';
    });
  }

  // ============ Buttons ============
  function setupButtons() {
    $('#rotate-ccw-btn').addEventListener('click', function () {
      if (cropper) cropper.rotate(-90);
    });
    $('#rotate-cw-btn').addEventListener('click', function () {
      if (cropper) cropper.rotate(90);
    });
    $('#new-image-btn').addEventListener('click', function () {
      var fileInput = $('#file-input');
      fileInput.value = '';
      fileInput.click();
    });
    $('#reset-btn').addEventListener('click', resetAll);
    $('#preview-btn').addEventListener('click', showPreview);
    $('#back-btn').addEventListener('click', function () {
      showSection('edit-section');
    });
    $('#download-btn').addEventListener('click', downloadPNG);
    $('#highlight-box-btn').addEventListener('click', function () {
      highlightMode = !highlightMode;
      var btn = $('#highlight-box-btn');
      if (highlightMode) {
        btn.style.backgroundColor = '#B91C1C';
      } else {
        btn.style.backgroundColor = '#EF4444';
      }
    });
  }

  // ============ Text Helpers ============
  function anonymizeName(name) {
    if (!name) return '';
    var t = name.trim();
    var len = t.length;
    if (len === 0) return '';
    if (len === 1) return t;
    if (len === 2) return t[0] + 'O';
    if (len === 3) return t[0] + 'O' + t[2];
    return t[0] + 'O'.repeat(len - 2) + t[len - 1];
  }

  function buildTextLines() {
    var name = $('#patient-name').value;
    var gender = $('#patient-gender').value;
    var age = $('#patient-age').value;
    var cc = $('#patient-cc').value;
    var extra = $('#extra-select').value;
    var rhythm = $('#rhythm-select').value;

    var lines = [];
    var anon = anonymizeName(name);
    var genderAge = '';
    if (gender && age) genderAge = '(' + gender + '/' + age + ')';
    else if (gender) genderAge = '(' + gender + ')';
    else if (age) genderAge = '(' + age + ')';

    if (anon && genderAge) lines.push(anon + ' ' + genderAge);
    else if (anon) lines.push(anon);
    else if (genderAge) lines.push(genderAge);
    if (cc) lines.push('c.c: ' + cc);

    if (extra === 'summary') {
      lines.push('summary');
    } else if (RHYTHM_OPTIONS.includes(extra)) {
      lines.push(extra + ': ' + rhythm);
    }
    return lines;
  }

  function generateFilename() {
    var anon = anonymizeName($('#patient-name').value);
    var gender = $('#patient-gender').value;
    var age = $('#patient-age').value;
    var cc = $('#patient-cc').value;
    var extra = $('#extra-select').value;
    var rhythm = $('#rhythm-select').value;

    var parts = [];
    if (anon) parts.push(anon);
    if (gender && age) parts.push('(' + gender + age + ')');
    if (cc) parts.push(cc);

    if (extra === 'summary') {
      parts.push('summary');
    } else if (RHYTHM_OPTIONS.includes(extra)) {
      parts.push(extra);
      parts.push(rhythm);
    }

    var filename = parts.join('_');
    filename = filename.replace(/[\\/:*?"<>|]/g, '');
    return (filename || 'ecg_crop') + '.png';
  }

  function clearHighlightBoxes() {
    highlightBoxes.forEach(function (box) {
      if (box.el && box.el.parentNode) box.el.parentNode.removeChild(box.el);
    });
    highlightBoxes = [];
  }

  // ============ Preview ============
  function showPreview() {
    if (!cropper) {
      alert('이미지를 먼저 업로드해주세요.');
      return;
    }

    croppedCanvas = cropper.getCroppedCanvas();
    if (!croppedCanvas) {
      alert('크롭 영역을 선택해주세요.');
      return;
    }

    var previewImage = $('#preview-image');
    showSection('preview-section');
    clearHighlightBoxes();
    highlightMode = false;
    var hlBtn = $('#highlight-box-btn');
    if (hlBtn) hlBtn.style.backgroundColor = '#EF4444';

    previewImage.onload = function () {
      updateTextBoxContent();
      initTextBox();
      setupDragResize();
    };
    previewImage.src = croppedCanvas.toDataURL('image/png');
  }

  function updateTextBoxContent() {
    var lines = buildTextLines();
    var contentDiv = $('#text-content');
    contentDiv.innerHTML = lines.map(function (l) {
      return '<div class="text-line">' + escapeHtml(l) + '</div>';
    }).join('');
  }

  function initTextBox() {
    var textBox = $('#text-box');
    textBox.style.left = '10px';
    textBox.style.top = '10px';
    textBox.style.width = 'auto';
    textBox.style.height = 'auto';
    textBox.style.fontSize = BASE_FONT_SIZE + 'px';

    requestAnimationFrame(function () {
      baseBoxWidth = textBox.offsetWidth;
      textBox.style.width = baseBoxWidth + 'px';
      textBox.style.height = textBox.offsetHeight + 'px';
    });
  }

  function updateFontSize(boxWidth) {
    var ratio = boxWidth / baseBoxWidth;
    var newFontSize = Math.round(BASE_FONT_SIZE * ratio);
    $('#text-box').style.fontSize = Math.max(8, newFontSize) + 'px';
  }

  // ============ Highlight Box Helpers ============
  function getHlEdge(el, clientX, clientY) {
    var rect = el.getBoundingClientRect();
    var t = 8;
    var edge = '';
    if (clientY - rect.top < t) edge += 'n';
    else if (rect.bottom - clientY < t) edge += 's';
    if (clientX - rect.left < t) edge += 'w';
    else if (rect.right - clientX < t) edge += 'e';
    return edge;
  }

  function edgeToCursor(edge) {
    var map = {
      'n': 'ns-resize', 's': 'ns-resize', 'w': 'ew-resize', 'e': 'ew-resize',
      'nw': 'nwse-resize', 'se': 'nwse-resize', 'ne': 'nesw-resize', 'sw': 'nesw-resize'
    };
    return map[edge] || 'move';
  }

  function attachHlListeners(el) {
    el.addEventListener('mousemove', function (e) {
      if (isDraggingHl || isResizingHl || isDrawingHighlight) return;
      el.style.cursor = edgeToCursor(getHlEdge(el, e.clientX, e.clientY));
    });
    el.addEventListener('dblclick', function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      highlightBoxes = highlightBoxes.filter(function (b) { return b.el !== el; });
    });
  }

  // ============ Drag & Resize ============
  function setupDragResize() {
    var textBox = $('#text-box');
    var container = $('#preview-container');
    var handles = textBox.querySelectorAll('.resize-handle');

    textBox.onmousedown = function (e) {
      if (e.target.classList.contains('resize-handle')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragBoxStartX = textBox.offsetLeft;
      dragBoxStartY = textBox.offsetTop;
      e.preventDefault();
    };

    handles.forEach(function (handle) {
      handle.onmousedown = function (e) {
        isResizing = true;
        resizeDir = handle.dataset.dir;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeStartW = textBox.offsetWidth;
        resizeStartH = textBox.offsetHeight;
        resizeStartLeft = textBox.offsetLeft;
        resizeStartTop = textBox.offsetTop;
        e.preventDefault();
        e.stopPropagation();
      };
    });

    container.addEventListener('mousedown', function (e) {
      if (!highlightMode) return;
      if (e.target.closest('#text-box')) return;

      var hlBox = e.target.closest('.highlight-box');
      if (Date.now() - lastHlActionTime < 100) return;

      if (hlBox) {
        var edge = getHlEdge(hlBox, e.clientX, e.clientY);
        if (edge) {
          isResizingHl = true;
          resizingHlEl = hlBox;
          hlResizeEdge = edge;
          hlResizeStartMouseX = e.clientX;
          hlResizeStartMouseY = e.clientY;
          hlResizeOrigLeft = hlBox.offsetLeft;
          hlResizeOrigTop = hlBox.offsetTop;
          hlResizeOrigW = hlBox.offsetWidth;
          hlResizeOrigH = hlBox.offsetHeight;
        } else {
          var cRect = container.getBoundingClientRect();
          isDraggingHl = true;
          draggingHlEl = hlBox;
          hlDragOffsetX = e.clientX - cRect.left - hlBox.offsetLeft;
          hlDragOffsetY = e.clientY - cRect.top - hlBox.offsetTop;
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      var rect = container.getBoundingClientRect();
      hlStartX = e.clientX - rect.left;
      hlStartY = e.clientY - rect.top;
      isDrawingHighlight = true;

      currentHlEl = document.createElement('div');
      currentHlEl.className = 'highlight-box';
      currentHlEl.style.position = 'absolute';
      currentHlEl.style.border = '2px solid red';
      currentHlEl.style.boxSizing = 'border-box';
      currentHlEl.style.pointerEvents = 'auto';
      currentHlEl.style.cursor = 'move';
      currentHlEl.style.left = hlStartX + 'px';
      currentHlEl.style.top = hlStartY + 'px';
      currentHlEl.style.width = '0px';
      currentHlEl.style.height = '0px';
      container.appendChild(currentHlEl);
      e.preventDefault();
    });

    document.onmousemove = function (e) {
      if (isDrawingHighlight && currentHlEl) {
        var rect = container.getBoundingClientRect();
        var curX = e.clientX - rect.left;
        var curY = e.clientY - rect.top;
        var x = Math.min(hlStartX, curX);
        var y = Math.min(hlStartY, curY);
        var w = Math.abs(curX - hlStartX);
        var h = Math.abs(curY - hlStartY);
        currentHlEl.style.left = x + 'px';
        currentHlEl.style.top = y + 'px';
        currentHlEl.style.width = w + 'px';
        currentHlEl.style.height = h + 'px';
        return;
      }

      if (isDraggingHl && draggingHlEl) {
        var rect = container.getBoundingClientRect();
        var newLeft = e.clientX - rect.left - hlDragOffsetX;
        var newTop = e.clientY - rect.top - hlDragOffsetY;
        newLeft = Math.max(0, Math.min(newLeft, container.clientWidth - draggingHlEl.offsetWidth));
        newTop = Math.max(0, Math.min(newTop, container.clientHeight - draggingHlEl.offsetHeight));
        draggingHlEl.style.left = newLeft + 'px';
        draggingHlEl.style.top = newTop + 'px';
        return;
      }

      if (isResizingHl && resizingHlEl) {
        var dx = e.clientX - hlResizeStartMouseX;
        var dy = e.clientY - hlResizeStartMouseY;
        var minS = 10;
        var nL = hlResizeOrigLeft;
        var nT = hlResizeOrigTop;
        var nW = hlResizeOrigW;
        var nH = hlResizeOrigH;

        if (hlResizeEdge.includes('e')) nW = Math.max(minS, hlResizeOrigW + dx);
        if (hlResizeEdge.includes('w')) {
          nW = Math.max(minS, hlResizeOrigW - dx);
          nL = hlResizeOrigLeft + (hlResizeOrigW - nW);
        }
        if (hlResizeEdge.includes('s')) nH = Math.max(minS, hlResizeOrigH + dy);
        if (hlResizeEdge.includes('n')) {
          nH = Math.max(minS, hlResizeOrigH - dy);
          nT = hlResizeOrigTop + (hlResizeOrigH - nH);
        }

        resizingHlEl.style.left = nL + 'px';
        resizingHlEl.style.top = nT + 'px';
        resizingHlEl.style.width = nW + 'px';
        resizingHlEl.style.height = nH + 'px';
        return;
      }

      if (isDragging) {
        var dx = e.clientX - dragStartX;
        var dy = e.clientY - dragStartY;
        var newLeft = dragBoxStartX + dx;
        var newTop = dragBoxStartY + dy;

        var maxLeft = container.clientWidth - textBox.offsetWidth;
        var maxTop = container.clientHeight - textBox.offsetHeight;
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));

        textBox.style.left = newLeft + 'px';
        textBox.style.top = newTop + 'px';
      }

      if (isResizing) {
        var rdx = e.clientX - resizeStartX;
        var rdy = e.clientY - resizeStartY;
        var minW = 80;
        var minH = 30;
        var newW = resizeStartW;
        var newH = resizeStartH;
        var nLeft = resizeStartLeft;
        var nTop = resizeStartTop;

        if (resizeDir.includes('e')) newW = Math.max(minW, resizeStartW + rdx);
        if (resizeDir.includes('w')) {
          newW = Math.max(minW, resizeStartW - rdx);
          nLeft = resizeStartLeft + (resizeStartW - newW);
        }
        if (resizeDir.includes('s')) newH = Math.max(minH, resizeStartH + rdy);
        if (resizeDir.includes('n')) {
          newH = Math.max(minH, resizeStartH - rdy);
          nTop = resizeStartTop + (resizeStartH - newH);
        }

        textBox.style.width = newW + 'px';
        textBox.style.height = newH + 'px';
        textBox.style.left = nLeft + 'px';
        textBox.style.top = nTop + 'px';

        updateFontSize(newW);
      }
    };

    document.onmouseup = function () {
      if (isDrawingHighlight && currentHlEl) {
        isDrawingHighlight = false;
        var w = parseInt(currentHlEl.style.width);
        var h = parseInt(currentHlEl.style.height);
        if (w < 5 || h < 5) {
          currentHlEl.parentNode.removeChild(currentHlEl);
        } else {
          highlightBoxes.push({ el: currentHlEl });
          attachHlListeners(currentHlEl);
        }
        currentHlEl = null;
        return;
      }
      if (isDraggingHl) {
        isDraggingHl = false;
        draggingHlEl = null;
        lastHlActionTime = Date.now();
        return;
      }
      if (isResizingHl) {
        isResizingHl = false;
        resizingHlEl = null;
        lastHlActionTime = Date.now();
        return;
      }
      isDragging = false;
      isResizing = false;
    };
  }

  // ============ Download ============
  function downloadPNG() {
    if (!croppedCanvas) return;

    var previewImage = $('#preview-image');
    var textBox = $('#text-box');

    var scaleX = croppedCanvas.width / previewImage.clientWidth;
    var scaleY = croppedCanvas.height / previewImage.clientHeight;

    var outCanvas = document.createElement('canvas');
    outCanvas.width = croppedCanvas.width;
    outCanvas.height = croppedCanvas.height;
    var ctx = outCanvas.getContext('2d');

    ctx.drawImage(croppedCanvas, 0, 0);

    var boxX = textBox.offsetLeft * scaleX;
    var boxY = textBox.offsetTop * scaleY;
    var boxW = textBox.offsetWidth * scaleX;
    var boxH = textBox.offsetHeight * scaleY;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    var lines = buildTextLines();
    var fontRatio = baseBoxWidth > 0 ? textBox.offsetWidth / baseBoxWidth : 1;
    var fontSize = Math.round(Math.max(8, BASE_FONT_SIZE * fontRatio) * scaleX);
    var lineHeight = Math.round(fontSize * 1.5);
    var paddingX = Math.round(12 * fontRatio * scaleX);
    var paddingY = Math.round(8 * fontRatio * scaleY);

    ctx.save();
    ctx.beginPath();
    ctx.rect(boxX, boxY, boxW, boxH);
    ctx.clip();

    ctx.fillStyle = '#000000';
    ctx.font = 'bold ' + fontSize + "px 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, 'Helvetica Neue', 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
    ctx.textBaseline = 'top';

    lines.forEach(function (line, i) {
      ctx.fillText(line, boxX + paddingX, boxY + paddingY + i * lineHeight);
    });

    ctx.restore();

    highlightBoxes.forEach(function (box) {
      var hlLeft = box.el.offsetLeft * scaleX;
      var hlTop = box.el.offsetTop * scaleY;
      var hlW = box.el.offsetWidth * scaleX;
      var hlH = box.el.offsetHeight * scaleY;
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2 * scaleX;
      ctx.strokeRect(hlLeft, hlTop, hlW, hlH);
    });

    var link = document.createElement('a');
    link.download = generateFilename();
    link.href = outCanvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

})();
