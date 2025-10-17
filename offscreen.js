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

    const isUnset = (state === 'unset');
    const isMuted = (state === 'pageMute' || state === 'domainMute');
    const isPinned = (state === 'pageMute' || state === 'pageSet');

    // 1. ベースアイコンを描画（未設定の場合はグレースケール）
    if (isUnset) {
        ctx.filter = 'grayscale(100%) opacity(60%)';
        ctx.drawImage(baseIcon, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none';
    } else {
        ctx.drawImage(baseIcon, 0, 0, canvas.width, canvas.height);
    }

    // 2. ミュートオーバーレイを描画
    if (isMuted) {
        drawMuteOverlay();
    }

    // 3. PINバッジを描画
    if (isPinned) {
        drawPinBadge();
    }
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // ImageData objects can't be sent over messaging. Send the raw data as a plain
    // array to ensure it's deserialized correctly.
    return {
        data: Array.from(imageData.data),
        width: imageData.width,
        height: imageData.height
    };
}

function drawMuteOverlay() {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = canvas.width / 2.8;

    ctx.fillStyle = 'rgba(231, 76, 60, 0.9)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(centerX - radius / 1.8, centerY + radius / 1.8);
    ctx.lineTo(centerX + radius / 1.8, centerY - radius / 1.8);
    ctx.stroke();
}

function drawPinBadge() {
    const badgeRadius = canvas.width / 5;
    const badgeCenterX = canvas.width - badgeRadius - 2;
    const badgeCenterY = badgeRadius + 2;

    // Circle background
    ctx.fillStyle = '#007AFF'; // Blue color for the badge
    ctx.beginPath();
    ctx.arc(badgeCenterX, badgeCenterY, badgeRadius, 0, 2 * Math.PI);
    ctx.fill();

    // Pin shape (simplified)
    const pinHeadRadius = badgeRadius / 3.5;
    const pinBodyLength = badgeRadius * 0.9;
    const pinTipY = badgeCenterY + pinHeadRadius + pinBodyLength;

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    // Pin head (circle)
    ctx.beginPath();
    ctx.arc(badgeCenterX, badgeCenterY - pinHeadRadius / 2, pinHeadRadius, 0, 2 * Math.PI);
    ctx.fillStyle = 'white';
    ctx.fill();

    // Pin body (line)
    ctx.beginPath();
    ctx.moveTo(badgeCenterX, badgeCenterY);
    ctx.lineTo(badgeCenterX, pinTipY);
    ctx.stroke();
}
