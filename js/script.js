document.addEventListener('DOMContentLoaded', () => {
    setupBackground();
    setupAccordion();
});

/* ---- Background crossfade -------------------------------------------------
 * Two double-buffered layers; paint the incoming still on the hidden one,
 * swap which is visible, then flip the references. Triggered by hover and
 * keyboard focus on any [data-bgimg] in main (rows + the contact link).
 */
function setupBackground() {
    const layers = document.querySelectorAll('.bg-layer');
    if (layers.length < 2) return;

    const defaultBg = getComputedStyle(document.documentElement)
        .getPropertyValue('--bg-default')
        .trim();

    let front = layers[0];
    let back = layers[1];
    let current = defaultBg;

    front.style.backgroundImage = defaultBg;
    front.classList.add('is-visible');

    const show = (image) => {
        if (image === current) return;
        current = image;
        back.style.backgroundImage = image;
        back.classList.add('is-visible');
        front.classList.remove('is-visible');
        [front, back] = [back, front];
    };

    const canHover = window.matchMedia('(hover: hover)').matches;
    let timeoutId;

    document.querySelectorAll('main [data-bgimg]').forEach((el) => {
        const image = `url("${el.dataset.bgimg}")`;

        // Preload only on hover-capable devices.
        if (canHover) {
            new Image().src = el.dataset.bgimg;
        }

        const enter = () => {
            clearTimeout(timeoutId);
            show(image);
        };
        const leave = () => {
            timeoutId = setTimeout(() => show(defaultBg), 200);
        };

        el.addEventListener('mouseover', enter);
        el.addEventListener('mouseout', leave);
        el.addEventListener('focus', enter);
        el.addEventListener('blur', leave);
    });
}

/* ---- Accordion ------------------------------------------------------------
 * Clone the placeholder panel template after each row, wire ARIA, and toggle
 * one open at a time. Panels animate open via CSS (grid-template-rows 0fr->1fr).
 */
function setupAccordion() {
    const template = document.getElementById('panel-tpl');
    if (!template) return;

    const rows = [...document.querySelectorAll('.row')];

    rows.forEach((row, i) => {
        const panel = template.content.firstElementChild.cloneNode(true);
        const id = `panel-${i + 1}`;
        const title = row.querySelector('.title').textContent;

        panel.id = id;
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', `${title} — details`);
        panel.querySelector('.watch').href = row.dataset.href;

        row.setAttribute('aria-controls', id);
        row.setAttribute('aria-expanded', 'false');
        row.after(panel);

        row.addEventListener('click', () => {
            const isOpen = row.getAttribute('aria-expanded') === 'true';

            // Single-open: collapse any other expanded row.
            rows.forEach((other) => {
                if (other !== row) {
                    other.setAttribute('aria-expanded', 'false');
                    other.nextElementSibling.classList.remove('open');
                }
            });

            row.setAttribute('aria-expanded', String(!isOpen));
            panel.classList.toggle('open', !isOpen);
        });
    });
}
