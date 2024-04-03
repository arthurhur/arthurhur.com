document.addEventListener('DOMContentLoaded', () => {
    const links = document.querySelectorAll('a');
    const preloadedImages = [];

    links.forEach(link => {
        const bgImageUrl = link.dataset.bgimg;

        const img = new Image();
        img.src = bgImageUrl;
        preloadedImages.push(img);

        link.addEventListener('mouseover', () => {
            document.body.style.backgroundImage = `url('${bgImageUrl}')`;
        });

        link.addEventListener('mouseout', () => {
            document.body.style.backgroundImage = 'var(--bg-image)';
        });
    });
});