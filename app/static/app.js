(() => {
  "use strict";

  // ---------- State ----------
  const state = {
    conversationId: getOrCreateConversationId(),
    voice: localStorage.getItem("aurality_voice") || null,
    autoplay: true,
    recording: false,
    mediaRecorder: null,
    chunks: [],
    audioCtx: null,
    analyser: null,
    micStream: null,
    rafId: null,
  };

  // ---------- Elements ----------
  const el = {
    messages: document.getElementById("messages"),
    emptyState: document.getElementById("emptyState"),
    composer: document.getElementById("composer"),
    textInput: document.getElementById("textInput"),
    sendBtn: document.getElementById("sendBtn"),
    micBtn: document.getElementById("micBtn"),
    statusLine: document.getElementById("statusLine"),
    pipeline: document.getElementById("pipeline"),
    waveform: document.getElementById("waveform"),
    voiceSelect: document.getElementById("voiceSelect"),
    autoplayToggle: document.getElementById("autoplayToggle"),
    resetBtn: document.getElementById("resetBtn"),
    themeToggle: document.getElementById("themeToggle"),
  };

  const wfCtx = el.waveform.getContext("2d");

  // ---------- Init ----------
  initTheme();
  loadVoices();
  idleWaveform();
  autoGrow(el.textInput);

  el.composer.addEventListener("submit", onSubmitText);
  el.textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.composer.requestSubmit();
    }
  });
  el.textInput.addEventListener("input", () => autoGrow(el.textInput));
  el.micBtn.addEventListener("click", toggleRecording);
  el.resetBtn.addEventListener("click", resetConversation);
  el.themeToggle.addEventListener("click", toggleTheme);
  el.autoplayToggle.addEventListener("change", () => {
    state.autoplay = el.autoplayToggle.checked;
  });
  el.voiceSelect.addEventListener("change", () => {
    state.voice = el.voiceSelect.value;
    localStorage.setItem("aurality_voice", state.voice);
  });

  // ---------- Conversation id ----------
  function getOrCreateConversationId() {
    let id = localStorage.getItem("aurality_conversation_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("aurality_conversation_id", id);
    }
    return id;
  }

  // ---------- Theme ----------
  function initTheme() {
    const saved = localStorage.getItem("aurality_theme") || "dark";
    document.documentElement.dataset.theme = saved;
    el.themeToggle.textContent = saved === "dark" ? "Light mode" : "Dark mode";
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("aurality_theme", next);
    el.themeToggle.textContent = next === "dark" ? "Light mode" : "Dark mode";
  }

  // ---------- Voices ----------
  async function loadVoices() {
    try {
      const res = await fetch("/api/voices");
      const data = await res.json();
      el.voiceSelect.innerHTML = "";
      data.voices.forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = `${v.label} — ${v.tone}`;
        el.voiceSelect.appendChild(opt);
      });
      if (state.voice && data.voices.some((v) => v.id === state.voice)) {
        el.voiceSelect.value = state.voice;
      } else {
        state.voice = el.voiceSelect.value;
      }
    } catch (e) {
      // Voice list is a nicety, not fatal if it fails.
    }
  }

  // ---------- Pipeline status ----------
  function setStage(name, status) {
    // status: "active" | "done" | "" (reset)
    el.pipeline.querySelectorAll(".stage").forEach((li) => {
      if (li.dataset.stage === name) {
        li.classList.toggle("active", status === "active");
        li.classList.toggle("done", status === "done");
      }
    });
  }
  function resetPipeline() {
    el.pipeline.querySelectorAll(".stage").forEach((li) => {
      li.classList.remove("active", "done");
    });
  }
  function setStatus(text, isError = false) {
    el.statusLine.textContent = text || "\u00A0";
    el.statusLine.classList.toggle("error", isError);
  }

  // ---------- Messages ----------
  function hideEmptyState() {
    if (el.emptyState) el.emptyState.style.display = "none";
  }

  function addUserMessage(text) {
    hideEmptyState();
    const div = document.createElement("div");
    div.className = "msg msg-user";
    div.innerHTML = `<div class="bubble"></div>`;
    div.querySelector(".bubble").textContent = text;
    el.messages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function addTypingBubble() {
    hideEmptyState();
    const div = document.createElement("div");
    div.className = "msg msg-assistant typing";
    div.innerHTML = `<div class="bubble"><span class="bar"></span><span class="bar"></span><span class="bar"></span></div>`;
    el.messages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function fillAssistantBubble(node, text) {
    node.classList.remove("typing");
    node.innerHTML = `<div class="bubble"></div>`;
    node.querySelector(".bubble").textContent = text;
    return node;
  }

  function addAudioRow(node, audioUrl) {
    const row = document.createElement("div");
    row.className = "audio-row";
    row.innerHTML = `
      <button type="button" class="play-btn" aria-label="Play reply">&#9654;</button>
      <canvas class="mini-wave" width="220" height="26"></canvas>
      <a class="dl-btn" href="${audioUrl}" download>&#8595;</a>
    `;
    node.appendChild(row);

    const audio = new Audio(audioUrl);
    const playBtn = row.querySelector(".play-btn");
    const canvas = row.querySelector(".mini-wave");
    const ctx = canvas.getContext("2d");
    let peaks = null;

    fetch(audioUrl)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        return ac.decodeAudioData(buf);
      })
      .then((decoded) => {
        peaks = computePeaks(decoded, 40);
        drawMiniWave(ctx, canvas, peaks, 0);
      })
      .catch(() => {
        peaks = new Array(40).fill(0.3);
        drawMiniWave(ctx, canvas, peaks, 0);
      });

    function loop() {
      if (peaks) {
        const progress = audio.duration ? audio.currentTime / audio.duration : 0;
        drawMiniWave(ctx, canvas, peaks, progress);
      }
      if (!audio.paused && !audio.ended) requestAnimationFrame(loop);
    }

    playBtn.addEventListener("click", () => {
      if (audio.paused) {
        audio.play();
        playBtn.innerHTML = "&#10074;&#10074;";
        loop();
      } else {
        audio.pause();
        playBtn.innerHTML = "&#9654;";
      }
    });
    audio.addEventListener("ended", () => {
      playBtn.innerHTML = "&#9654;";
      if (peaks) drawMiniWave(ctx, canvas, peaks, 0);
    });

    if (state.autoplay) {
      audio.play().then(() => {
        playBtn.innerHTML = "&#10074;&#10074;";
        loop();
      }).catch(() => {
        /* autoplay can be blocked until the user interacts with the page */
      });
    }
  }

  function scrollToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  // ---------- Send text ----------
  async function onSubmitText(e) {
    e.preventDefault();
    const text = el.textInput.value.trim();
    if (!text) return;
    el.textInput.value = "";
    autoGrow(el.textInput);
    addUserMessage(text);
    await runChatAndSpeak(text);
  }

async function runChatAndSpeak(text) {
  el.sendBtn.disabled = true;
  setStage("speech", "done");
  setStage("stt", "done");
  setStage("llm", "active");
  setStatus("Thinking through a reply…");

  const typingNode = addTypingBubble();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        conversation_id: state.conversationId
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(
        data.detail || "The assistant couldn't answer that."
      );
    }

    setStage("llm", "done");

    fillAssistantBubble(typingNode, data.answer);
    scrollToBottom();

    // Browser text-to-speech
    setStage("tts", "active");
    setStatus("Speaking the reply…");

    if (state.autoplay) {
      speakWithBrowser(data.answer);
    }

    setStage("tts", "done");
    setStatus("");

  } catch (err) {
    typingNode.remove();
    setStatus(err.message, true);
  } finally {
    el.sendBtn.disabled = false;
    setTimeout(resetPipeline, 900);
  }
}
function speakWithBrowser(text) {
  if (!("speechSynthesis" in window)) {
    setStatus("Speech synthesis is not supported in this browser.", true);
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);

  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;

  const voices = window.speechSynthesis.getVoices();

  // Try to use an English voice
  const englishVoice = voices.find(
    (voice) => voice.lang && voice.lang.startsWith("en")
  );

  if (englishVoice) {
    utterance.voice = englishVoice;
  }

  utterance.onstart = () => {
    setStatus("Speaking…");
  };

  utterance.onend = () => {
    setStatus("");
  };

  utterance.onerror = () => {
    setStatus("Could not play the voice reply.", true);
  };

  window.speechSynthesis.speak(utterance);
}


  // ---------- Recording ----------
  async function toggleRecording() {
    if (state.recording) {
      stopRecording();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.micStream = stream;
      state.chunks = [];
      state.mediaRecorder = new MediaRecorder(stream);
      state.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size) state.chunks.push(e.data);
      };
      state.mediaRecorder.onstop = onRecordingStopped;
      state.mediaRecorder.start();
      state.recording = true;
      el.micBtn.classList.add("recording");
      setStage("speech", "active");
      setStatus("Listening… click the mic again to stop.");
      startLiveWaveform(stream);
    } catch (e) {
      setStatus("Microphone access wasn't available.", true);
    }
  }

  function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
      state.mediaRecorder.stop();
    }
    state.recording = false;
    el.micBtn.classList.remove("recording");
    stopLiveWaveform();
  }

  async function onRecordingStopped() {
    state.micStream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(state.chunks, { type: "audio/webm" });
    setStage("speech", "done");
    setStage("stt", "active");
    setStatus("Transcribing what you said…");

    try {
      const form = new FormData();
      form.append("audio", blob, "question.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Couldn't transcribe that.");

      setStage("stt", "done");
      addUserMessage(data.transcript);
      await runChatAndSpeak(data.transcript);
    } catch (err) {
      setStatus(err.message, true);
      setTimeout(resetPipeline, 900);
    }
  }

  // ---------- Waveform (idle + live) ----------
  function idleWaveform() {
    let t = 0;
    function frame() {
      if (!state.recording) {
        drawIdle(t);
        t += 0.02;
      }
      requestAnimationFrame(frame);
    }
    frame();
  }

  function drawIdle(t) {
    const { width, height } = el.waveform;
    wfCtx.clearRect(0, 0, width, height);
    wfCtx.strokeStyle = "rgba(124,108,240,0.55)";
    wfCtx.lineWidth = 2;
    wfCtx.beginPath();
    for (let x = 0; x <= width; x += 4) {
      const y = height / 2 + Math.sin(x * 0.03 + t * 3) * (height * 0.12);
      x === 0 ? wfCtx.moveTo(x, y) : wfCtx.lineTo(x, y);
    }
    wfCtx.stroke();
  }

  function startLiveWaveform(stream) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = state.audioCtx.createMediaStreamSource(stream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 512;
    source.connect(state.analyser);

    const bufferLength = state.analyser.frequencyBinCount;
    const data = new Uint8Array(bufferLength);

    function draw() {
      state.rafId = requestAnimationFrame(draw);
      state.analyser.getByteTimeDomainData(data);
      const { width, height } = el.waveform;
      wfCtx.clearRect(0, 0, width, height);
      wfCtx.strokeStyle = "#2FD9C4";
      wfCtx.lineWidth = 2;
      wfCtx.beginPath();
      const slice = width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = data[i] / 128.0;
        const y = (v * height) / 2;
        i === 0 ? wfCtx.moveTo(x, y) : wfCtx.lineTo(x, y);
        x += slice;
      }
      wfCtx.stroke();
    }
    draw();
  }

  function stopLiveWaveform() {
    if (state.rafId) cancelAnimationFrame(state.rafId);
    if (state.audioCtx) state.audioCtx.close();
    state.audioCtx = null;
    state.analyser = null;
  }

  // ---------- Mini waveform for playback ----------
  function computePeaks(audioBuffer, bars) {
    const raw = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(raw.length / bars);
    const peaks = [];
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) sum += Math.abs(raw[start + j] || 0);
      peaks.push(sum / blockSize);
    }
    const max = Math.max(...peaks, 0.001);
    return peaks.map((p) => Math.max(0.08, p / max));
  }

  function drawMiniWave(ctx, canvas, peaks, progress) {
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    const gap = 2;
    const barWidth = width / peaks.length - gap;
    peaks.forEach((p, i) => {
      const barHeight = Math.max(2, p * height);
      const x = i * (barWidth + gap);
      const y = (height - barHeight) / 2;
      const played = i / peaks.length <= progress;
      ctx.fillStyle = played ? "#2FD9C4" : "rgba(139,147,167,0.45)";
      ctx.fillRect(x, y, barWidth, barHeight);
    });
  }

  // ---------- Reset ----------
  async function resetConversation() {
    try {
      await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `conversation_id=${encodeURIComponent(state.conversationId)}`,
      });
    } catch (e) {
      /* non-fatal */
    }
    state.conversationId = crypto.randomUUID();
    localStorage.setItem("aurality_conversation_id", state.conversationId);
    el.messages.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.id = "emptyState";
    empty.innerHTML = `
      <h2>Ask something out loud, or type it in.</h2>
      <p>Every reply is thought through by an LLM and spoken back to you.
         Try "Explain RAG in simple terms" or hold the mic and just talk.</p>
    `;
    el.messages.appendChild(empty);
    el.emptyState = empty;
    setStatus("Started a new conversation.");
  }

  // ---------- Utility ----------
  function autoGrow(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
  }
})();
