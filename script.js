const music = document.getElementById('ariaMath');

if (music) {
    music.volume = 0.5;

    // Check if music should be playing
    if (localStorage.getItem('musicPlaying') === 'true' || localStorage.getItem('musicPlaying') === null) {
        const startAudio = () => {
            music.play().then(() => {
                localStorage.setItem('musicPlaying', 'true');
                window.removeEventListener('click', startAudio);
            }).catch(e => console.log("Audio waiting for click..."));
        };

        // Triggers music on the very first click on the site
        window.addEventListener('click', startAudio);
        
        // Attempt immediate play (works on tab switch)
        music.play().catch(() => {});
    }
}

// Page Transition Logic
document.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', function(e) {
        if (this.hostname === window.location.hostname && !this.hash && this.target !== "_blank") {
            e.preventDefault();
            const target = this.href;
            document.getElementById('bgOverlay').style.backdropFilter = "blur(25px)";
            document.querySelector('.page-wrapper').style.opacity = "0";
            document.querySelector('.page-wrapper').style.transition = "all 0.5s ease";
            setTimeout(() => { window.location.href = target; }, 500);
        }
    });
});