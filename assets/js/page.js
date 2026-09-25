// Простые страницы (политика, 404): только навигация.
const nav = document.getElementById('nav');
const burger = nav.querySelector('.nav__burger');
const menu = document.getElementById('menu');

nav.classList.add('nav--solid');
burger.addEventListener('click', () => {
  const open = menu.hidden;
  menu.hidden = !open;
  nav.classList.toggle('nav--open', open);
  burger.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
});
