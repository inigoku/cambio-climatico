const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
const seaLevelSlider = document.getElementById('seaLevelSlider');
const seaLevelLabel = document.getElementById('seaLevelLabel');
const loadingDiv = document.getElementById('loading');
const playPauseBtn = document.getElementById('playPause');
const stepForwardBtn = document.getElementById('stepForward');
const stepBackwardBtn = document.getElementById('stepBackward');

// --- Control de Temperatura ---
const tempContainer = document.createElement('div');
tempContainer.style.marginBottom = '15px';
tempContainer.innerHTML = `
    <label>Incr. Temp. (°C): <span id="tempLabel">0</span></label><br>
    <input type="range" id="tempSlider" min="0" max="20" step="0.1" value="0" style="width: 100%;">
`;

if (seaLevelSlider && seaLevelSlider.parentNode) {
    seaLevelSlider.parentNode.insertBefore(tempContainer, seaLevelSlider.parentNode.firstChild);
}

const tempSlider = document.getElementById('tempSlider');
const tempLabel = document.getElementById('tempLabel');

if (tempSlider) {
    tempSlider.addEventListener('input', () => {
        const temp = parseFloat(tempSlider.value);
        tempLabel.textContent = temp;
        const newSeaLevel = 0.26 * temp;
        seaLevelSlider.value = newSeaLevel;
        updateSeaLevelUI(newSeaLevel);
    });
}

let heightmap = null;
let isPlaying = false;
let animationInterval = null;

// Transformation state
let scale = 1.0;
let minScale = 1.0;
let offsetX = 0;
let offsetY = 0;

// Panning state
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;


// Colores (mapeados desde el script de Python)
const colors = {
    deep_sea: [0.0, 0.0, 0.6],
    sea: [0.2, 0.2, 0.8],
    coast: [0.2, 0.8, 0.2],
    lowland: [0.9, 0.9, 0.5],
    highland: [0.5, 0.4, 0.2],
    mountain_base: [0.6, 0.5, 0.5],
    mountain_top: [1.0, 1.0, 1.0],
    ice: [1.0, 1.0, 1.0],
};

// Convertir colores a rango 0-255 para rendimiento
for (const key in colors) {
    colors[key] = colors[key].map(c => Math.floor(c * 255));
}

// Umbrales (en metros)
const thresholds = {
    coast: 100,
    lowland: 400,
    highland: 1000,
    mountain: 2500
};

function clampConstraints() {
    if (!heightmap) return;
    const mapWidth = heightmap[0].length;
    const mapHeight = heightmap.length;
    const renderedWidth = mapWidth * scale;
    const renderedHeight = mapHeight * scale;

    // Limit X
    if (renderedWidth > canvas.width) {
        if (offsetX > 0) offsetX = 0;
        if (offsetX < canvas.width - renderedWidth) offsetX = canvas.width - renderedWidth;
    } else {
        offsetX = (canvas.width - renderedWidth) / 2;
    }

    // Limit Y
    if (renderedHeight > canvas.height) {
        if (offsetY > 0) offsetY = 0;
        if (offsetY < canvas.height - renderedHeight) offsetY = canvas.height - renderedHeight;
    } else {
        offsetY = (canvas.height - renderedHeight) / 2;
    }
}

function updateSeaLevelUI(seaLevel) {
    seaLevelLabel.textContent = seaLevel.toFixed(2);
    draw();
}

function draw() {
    if (!heightmap) return;

    const width = canvas.width;
    const height = canvas.height;
    
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    const mapHeight = heightmap.length;
    const mapWidth = heightmap[0].length;
    const seaLevel = parseFloat(seaLevelSlider.value);

    for (let y = 0; y < height; y++) {
        const mapY = Math.floor((y - offsetY) / scale);
        
        if (mapY < 0 || mapY >= mapHeight) continue;
        
        const row = heightmap[mapY];
        let pixelIndex = y * width * 4;

        for (let x = 0; x < width; x++) {
            const mapX = Math.floor((x - offsetX) / scale);

            if (mapX >= 0 && mapX < mapWidth) {
                const h = row[mapX];
                let c;

                if (h <= seaLevel) c = colors.deep_sea;
                else if (h <= 0) c = colors.sea;
                else if (h <= thresholds.coast) c = colors.coast;
                else if (h <= thresholds.lowland) c = colors.lowland;
                else if (h <= thresholds.highland) c = colors.highland;
                else if (h <= thresholds.mountain) c = colors.mountain_base;
                else c = colors.mountain_top;

                let r = c[0], g = c[1], b = c[2];

                // Capa de hielo
                const isSouthPolar = mapY > mapHeight * 0.85;
                if (isSouthPolar && h > seaLevel) {
                    r = colors.ice[0]; g = colors.ice[1]; b = colors.ice[2];
                }

                if (mapY < mapHeight * 0.2 && h > seaLevel) {
                    let iceOpacity = 0;
                    if (mapY < mapHeight * 0.1) {
                        iceOpacity = 1.0;
                    } else {
                        iceOpacity = 1.0 - ((mapY - (mapHeight * 0.1)) / (mapHeight * 0.1));
                    }
                    
                    if (iceOpacity > 0) {
                        r = Math.round(colors.ice[0] * iceOpacity + r * (1 - iceOpacity));
                        g = Math.round(colors.ice[1] * iceOpacity + g * (1 - iceOpacity));
                        b = Math.round(colors.ice[2] * iceOpacity + b * (1 - iceOpacity));
                    }
                }

                data[pixelIndex] = r;
                data[pixelIndex + 1] = g;
                data[pixelIndex + 2] = b;
                data[pixelIndex + 3] = 255;
            }
            pixelIndex += 4;
        }
    }
    ctx.putImageData(imageData, 0, 0);
}


async function main() {
    try {
        // Cargar mapa en fragmentos (para evitar límites de GitHub/Navegador)
        const numChunks = 4;
        const promises = [];
        for (let i = 0; i < numChunks; i++) {
            promises.push(fetch(`heightmap_part_${i}.json`).then(r => r.json()));
        }
        
        const chunks = await Promise.all(promises);
        heightmap = chunks.flat();
        
        loadingDiv.style.display = 'none';

        // Set canvas size based on container
        const container = document.querySelector('.container');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(container.clientWidth * dpr);
        const mapWidth = heightmap[0].length;
        const mapHeight = heightmap.length;
        canvas.height = Math.round(canvas.width * (mapHeight / mapWidth));
        
        // Calculate initial scale to fit the map
        const scaleX = canvas.width / mapWidth;
        const scaleY = canvas.height / mapHeight;
        scale = Math.min(scaleX, scaleY);
        minScale = scale;

        // Center the map
        offsetX = (canvas.width - mapWidth * scale) / 2;
        offsetY = (canvas.height - mapHeight * scale) / 2;

        clampConstraints();
        updateSeaLevelUI(parseFloat(seaLevelSlider.value));

    } catch (error) {
        loadingDiv.textContent = "Error al cargar el mapa.";
        console.error("Error fetching heightmap:", error);
    }
}

// Event Listeners
seaLevelSlider.addEventListener('input', () => {
    const seaLevel = parseFloat(seaLevelSlider.value);
    if (tempSlider && tempLabel) {
        const newTemp = seaLevel / 0.26;
        tempSlider.value = newTemp;
        tempLabel.textContent = newTemp.toFixed(1);
    }
    updateSeaLevelUI(seaLevel);
});

// Helper para obtener coordenadas precisas considerando el escalado del canvas
function getCanvasCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    const pos = getCanvasCoordinates(e);
    dragStartX = pos.x - offsetX;
    dragStartY = pos.y - offsetY;
    canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('mouseup', () => {
    isDragging = false;
    canvas.style.cursor = 'grab';
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
    canvas.style.cursor = 'default';
});

canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
        const pos = getCanvasCoordinates(e);
        offsetX = pos.x - dragStartX;
        offsetY = pos.y - dragStartY;
        clampConstraints();
        draw();
    }
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const scaleAmount = 1.1;
    const pos = getCanvasCoordinates(e);
    const mouseX = pos.x;
    const mouseY = pos.y;

    const worldX = (mouseX - offsetX) / scale;
    const worldY = (mouseY - offsetY) / scale;

    if (e.deltaY < 0) {
        // Zoom in
        scale *= scaleAmount;
    } else {
        // Zoom out
        scale /= scaleAmount;
    }

    // Clamp scale
    scale = Math.max(minScale, Math.min(scale, 20.0));

    offsetX = mouseX - worldX * scale;
    offsetY = mouseY - worldY * scale;

    clampConstraints();
    draw();
});


function step(amount) {
    let currentLevel = parseFloat(seaLevelSlider.value);
    currentLevel += amount;
    const min = parseFloat(seaLevelSlider.min);
    const max = parseFloat(seaLevelSlider.max);
    if (currentLevel > max) currentLevel = max;
    if (currentLevel < min) currentLevel = min;
    seaLevelSlider.value = currentLevel;
    updateSeaLevelUI(currentLevel);
}

stepForwardBtn.addEventListener('click', () => step(20));
stepBackwardBtn.addEventListener('click', () => step(-20));

playPauseBtn.addEventListener('click', () => {
    isPlaying = !isPlaying;
    if (isPlaying) {
        playPauseBtn.textContent = 'Pause';
        animationInterval = setInterval(() => {
            let currentLevel = parseFloat(seaLevelSlider.value);
             if (currentLevel >= parseFloat(seaLevelSlider.max)) {
                seaLevelSlider.value = seaLevelSlider.min;
            }
            step(20)
        }, 100);
    } else {
        playPauseBtn.textContent = 'Play';
        clearInterval(animationInterval);
    }
});

main();
canvas.style.cursor = 'grab';
