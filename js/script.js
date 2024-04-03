document.addEventListener('DOMContentLoaded', () => {
    const links = document.querySelectorAll('a');
    const preloadedImages = [];
    let timeoutId;

    links.forEach(link => {
        const bgImageUrl = link.dataset.bgimg;
        const img = new Image();
        img.src = bgImageUrl;
        preloadedImages.push(img);

        link.addEventListener('mouseover', () => {
            document.body.style.backgroundImage = `url('${bgImageUrl}')`;
            clearTimeout(timeoutId);
        });

        link.addEventListener('mouseout', () => {
            timeoutId = setTimeout(() => {
                document.body.style.backgroundImage = 'var(--bg-image)';
            }, 200);
        });
    });
});