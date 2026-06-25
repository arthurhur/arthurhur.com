document.addEventListener('DOMContentLoaded', () => {
    const layers = document.querySelectorAll('.bg-layer');
    if (layers.length < 2) return;

    // Authored value of --bg-default (custom props aren't normalized, so this
    // string stays exactly as written in the CSS).
    const defaultBg = getComputedStyle(document.documentElement)
        .getPropertyValue('--bg-default')
        .trim();

    let front = layers[0];
    let back = layers[1];
    let current = defaultBg;

    front.style.backgroundImage = defaultBg;
    front.classList.add('is-visible');

    // Crossfade to `image` by painting it on the hidden layer, swapping which
    // layer is visible, then flipping the front/back references.
    const show = (image) => {
        if (image === current) return;
        current = image;
        back.style.backgroundImage = image;
        back.classList.add('is-visible');
        front.classList.remove('is-visible');
        [front, back] = [back, front];
    };

    const links = document.querySelectorAll('main a[data-bgimg]');
    const canHover = window.matchMedia('(hover: hover)').matches;
    let timeoutId;

    links.forEach((link) => {
        const image = `url("${link.dataset.bgimg}")`;

        // Preload only on hover-capable devices — touch devices never trigger
        // the swap, so there's no point pulling ~8MB of photos over cellular.
        if (canHover) {
            new Image().src = link.dataset.bgimg;
        }

        const enter = () => {
            clearTimeout(timeoutId);
            show(image);
        };
        const leave = () => {
            timeoutId = setTimeout(() => show(defaultBg), 200);
        };

        // mouse + keyboard so tabbing through links swaps the background too.
        link.addEventListener('mouseover', enter);
        link.addEventListener('mouseout', leave);
        link.addEventListener('focus', enter);
        link.addEventListener('blur', leave);
    });
});
