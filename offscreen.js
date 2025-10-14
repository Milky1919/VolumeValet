// offscreen.js

const canvas = document.getElementById('iconCanvas');
const ctx = canvas.getContext('2d');

const baseIcon = new Image();
baseIcon.src = chrome.runtime.getURL('images/icon48.png');

let isBaseIconLoaded = false;
baseIcon.onload = () => {
    isBaseIconLoaded = true;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'offscreen' && message.action === 'drawIcon') {
        if (isBaseIconLoaded) {
            const imageData = drawIcon(message.state);
            sendResponse(imageData);
        } else {
            // If the icon isn't loaded yet, wait for it
            baseIcon.onload = () => {
                const imageData = drawIcon(message.state);
                sendResponse(imageData);
            };
        }
        return true; // Indicates that the response is sent asynchronously
    }
});

function drawIcon(state) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Step 1: Draw the base icon (Color or Grayscale)
    if (state.isSet) {
        // Draw color icon
        ctx.filter = 'none';
        ctx.drawImage(baseIcon, 0, 0, canvas.width, canvas.height);
    } else {
        // Draw grayscale icon
        ctx.filter = 'grayscale(100%) opacity(60%)';
        ctx.drawImage(baseIcon, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none'; // Reset filter
    }

    // Step 2: Draw the mute overlay if needed
    if (state.isMuted) {
        drawMuteOverlay();
    }
    
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}


function drawMuteOverlay() {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = canvas.width / 2.8;

    // Draw red circle background
    ctx.fillStyle = 'rgba(231, 76, 60, 0.9)'; // Red color
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.fill();

    // Draw slash
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(centerX - radius / 1.8, centerY + radius / 1.8);
    ctx.lineTo(centerX + radius / 1.8, centerY - radius / 1.8);
    ctx.stroke();
}
