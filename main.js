document.addEventListener('DOMContentLoaded', () => {
    // --- DOM要素 ---
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const refPitchInput = document.getElementById('ref-pitch');
    const keySelect = document.getElementById('key-select');
    const pitchChartCanvas = document.getElementById('pitchChart');

    // --- 音声処理関連 ---
    let audioContext;
    let mediaStreamSource;
    let analyser;
    let pitchFinder;
    let animationFrameId;
    const buffer = new Float32Array(1024);

    // --- グラフ・状態管理 ---
    let pitchChart;
    const MAX_DATA_POINTS = 300;
    const OCTAVE_RANGE = { min: 3, max: 5 }; // 表示するオクターブ範囲

    // --- 初期化 ---
    initializeChart();
    updateScaleGuides(); // 初期キーでガイド線を描画

    // --- イベントリスナー ---
    startButton.addEventListener('click', start);
    stopButton.addEventListener('click', stop);
    keySelect.addEventListener('change', updateScaleGuides);
    refPitchInput.addEventListener('change', updateScaleGuides);


    // =====================================================================
    // 機能実装
    // =====================================================================

    async function start() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamSource = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            mediaStreamSource.connect(analyser);
            pitchFinder = Pitchfinder.YIN({ sampleRate: audioContext.sampleRate });

            resetChartData();
            startButton.disabled = true;
            stopButton.disabled = false;

            updatePitch();
        } catch (err) {
            console.error('マイクエラー:', err);
            alert('マイクへのアクセスが拒否されました。');
        }
    }

    function stop() {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        if (mediaStreamSource) mediaStreamSource.mediaStream.getTracks().forEach(track => track.stop());
        if (audioContext && audioContext.state !== 'closed') audioContext.close();

        startButton.disabled = false;
        stopButton.disabled = true;
    }

    function updatePitch() {
        analyser.getFloatTimeDomainData(buffer);
        const frequency = pitchFinder(buffer);

        let midiValue = null;
        if (frequency) {
            const refA4 = getRefA4();
            midiValue = frequencyToMidi(frequency, refA4);
        }

        addDataToChart(midiValue);
        animationFrameId = requestAnimationFrame(updatePitch);
    }

    function initializeChart() {
        const ctx = pitchChartCanvas.getContext('2d');
        pitchChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    borderColor: 'rgb(255, 99, 132)',
                    borderWidth: 2,
                    tension: 0.1,
                    spanGaps: false,
                    pointRadius: 3,
                    pointBackgroundColor: 'rgb(255, 99, 132)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: 'Time' }, ticks: { display: false } },
                    y: {
                        title: { display: true, text: 'Pitch (Note)' },
                        min: midiToNoteName(12 * OCTAVE_RANGE.min, true), // e.g. C3
                        max: midiToNoteName(12 * (OCTAVE_RANGE.max + 1), true), // e.g. C6
                        ticks: {
                            stepSize: 1,
                            callback: function(value, index, ticks) {
                                // C, E, G# のような主要な音名のみ表示
                                return [0, 4, 8].includes(value % 12) ? midiToNoteName(value) : null;
                            }
                        }
                    }
                },
                plugins: {
                    zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } },
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const midiVal = context.raw;
                                const noteName = midiToNoteName(midiVal);
                                const cents = getCentsDeviation(midiVal);
                                const sign = cents >= 0 ? '+' : '';
                                return `${noteName} (${sign}${cents.toFixed(1)} cents)`;
                            }
                        }
                    },
                    annotation: {
                        annotations: {}
                    }
                }
            }
        });
    }

    function addDataToChart(value) {
        pitchChart.data.labels.push('');
        pitchChart.data.datasets[0].data.push(value);
        if (pitchChart.data.labels.length > MAX_DATA_POINTS) {
            pitchChart.data.labels.shift();
            pitchChart.data.datasets[0].data.shift();
        }
        pitchChart.update('none');
    }

    function resetChartData() {
        pitchChart.data.labels = [];
        pitchChart.data.datasets[0].data = [];
        pitchChart.update('none');
    }

    function updateScaleGuides() {
        const annotations = {};
        const selectedKey = keySelect.value;
        const keyRootIndex = noteNames.indexOf(selectedKey);
        if (keyRootIndex === -1) return;

        const scaleIntervals = MAJOR_SCALE_INTERVALS; // Major scale

        for (let octave = OCTAVE_RANGE.min; octave <= OCTAVE_RANGE.max; octave++) {
            for (let i = 0; i < scaleIntervals.length; i++) {
                const midiNum = 12 * (octave + 1) + keyRootIndex + scaleIntervals[i];
                const noteName = midiToNoteName(midiNum);

                annotations[noteName] = {
                    type: 'line',
                    yMin: midiNum,
                    yMax: midiNum,
                    borderColor: 'rgba(0, 0, 0, 0.1)',
                    borderWidth: 1,
                    label: {
                        content: noteName,
                        enabled: true,
                        position: 'end',
                        backgroundColor: 'rgba(255, 255, 255, 0)',
                        color: 'rgba(0, 0, 0, 0.4)',
                        font: { size: 10 }
                    }
                };
            }
        }
        pitchChart.options.plugins.annotation.annotations = annotations;

        // Y軸の範囲も更新
        const minMidi = 12 * (OCTAVE_RANGE.min + 1) + keyRootIndex;
        const maxMidi = 12 * (OCTAVE_RANGE.max + 1) + keyRootIndex;
        pitchChart.options.scales.y.min = minMidi - 6;
        pitchChart.options.scales.y.max = maxMidi + 6;

        pitchChart.update();
    }

    // =====================================================================
    // ユーティリティ関数
    // =====================================================================

    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

    function getRefA4() { return parseFloat(refPitchInput.value) || 442; }
    function frequencyToMidi(freq, refA4) { return 12 * (Math.log2(freq / refA4)) + 69; }

    function midiToNoteName(midi, integerOnly = false) {
        const roundedMidi = integerOnly ? Math.round(midi) : midi;
        const noteNum = Math.round(roundedMidi);
        const octave = Math.floor(noteNum / 12) - 1;
        const noteIndex = noteNum % 12;
        return noteNames[noteIndex] + octave;
    }

    function getCentsDeviation(midi) {
        const closestMidi = Math.round(midi);
        return (midi - closestMidi) * 100;
    }
});
