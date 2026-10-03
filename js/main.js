/* ═══════════════════════════════════════════════════════════════
   MAIN.JS — اسکریپت اصلی سایت
   شامل: منوی موبایل، اسکرول هدر، لینک فعال، انیمیشن ورود، سال شمسی
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ───────────────────────────────────────────────────────────
     ابزارهای کمکی
     ─────────────────────────────────────────────────────────── */

  // انتخاب یه عنصر
  const $ = (selector, scope = document) => scope.querySelector(selector);

  // انتخاب چند عنصر به صورت آرایه
  const $$ = (selector, scope = document) =>
    Array.from(scope.querySelectorAll(selector));

  // تبدیل عدد به رقم فارسی
  const faDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
  const toFa = (n) =>
    String(n).split('').map(d => faDigits[+d] ?? d).join('');

  // تشخیص دستگاه لمسی
  const isTouchDevice = () =>
    window.matchMedia('(hover: none)').matches;

  // احترام به کاهش انیمیشن
  const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // throttle ساده برای اسکرول
  const throttle = (fn, wait = 100) => {
    let last = 0;
    let timer = null;
    return function (...args) {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        last = now;
        fn.apply(this, args);
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn.apply(this, args);
        }, remaining);
      }
    };
  };


  /* ═══════════════════════════════════════════════════════════
     ۱) منوی موبایل
     ═══════════════════════════════════════════════════════════ */

  function initMobileMenu() {
    const menuBtn = $('#menuBtn');
    const mobileMenu = $('#mobileMenu');
    const mobileLinks = $$('.mobile-link');

    if (!menuBtn || !mobileMenu) return;

    let isOpen = false;

    const openMenu = () => {
      isOpen = true;
      mobileMenu.classList.add('open');
      mobileMenu.setAttribute('aria-hidden', 'false');
      menuBtn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    };

    const closeMenu = () => {
      isOpen = false;
      mobileMenu.classList.remove('open');
      mobileMenu.setAttribute('aria-hidden', 'true');
      menuBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    };

    const toggleMenu = () => {
      isOpen ? closeMenu() : openMenu();
    };

    // کلیک روی دکمه
    menuBtn.addEventListener('click', toggleMenu);

    // کلیک روی هر لینک منو → بستن
    mobileLinks.forEach(link => {
      link.addEventListener('click', closeMenu);
    });

    // کلیک بیرون از منو → بستن
    document.addEventListener('click', (e) => {
      if (!isOpen) return;
      if (mobileMenu.contains(e.target) || menuBtn.contains(e.target)) return;
      closeMenu();
    });

    // ESC → بستن
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) closeMenu();
    });

    // اگه اندازه صفحه بزرگ شد → بستن
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth > 720 && isOpen) closeMenu();
      }, 150);
    });
  }


  /* ═══════════════════════════════════════════════════════════
     ۲) هدر — تغییر استایل موقع اسکرول
     ═══════════════════════════════════════════════════════════ */

  function initHeaderScroll() {
    const header = $('#siteHeader');
    if (!header) return;

    const SCROLL_THRESHOLD = 20;

    const handleScroll = () => {
      const scrolled = window.scrollY > SCROLL_THRESHOLD;
      header.classList.toggle('scrolled', scrolled);
    };

    // اجرای اولیه
    handleScroll();

    // لیسنر با throttle برای پرفورمنس
    window.addEventListener('scroll', throttle(handleScroll, 80), { passive: true });
  }


  /* ═══════════════════════════════════════════════════════════
     ۳) لینک فعال نویگیشن بر اساس اسکرول
     ═══════════════════════════════════════════════════════════ */

  function initActiveNav() {
    const navLinks = $$('.nav-link');
    const sections = $$('section[id]');

    if (!navLinks.length || !sections.length) return;

    const header = $('#siteHeader');
    const headerHeight = header ? header.offsetHeight : 72;

    const updateActive = () => {
      const scrollY = window.scrollY + headerHeight + 60;
      let currentId = '';

      sections.forEach(section => {
        if (section.offsetTop <= scrollY) {
          currentId = section.id;
        }
      });

      // اگه به آخر صفحه رسیدیم → آخرین بخش فعال
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 4) {
        currentId = sections[sections.length - 1].id;
      }

      navLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        const targetId = href.replace('#', '');
        link.classList.toggle('active', targetId === currentId);
      });
    };

    updateActive();
    window.addEventListener('scroll', throttle(updateActive, 100), { passive: true });
    window.addEventListener('resize', throttle(updateActive, 200));
  }


  /* ═══════════════════════════════════════════════════════════
     ۴) اسکرول نرم برای لینک‌های داخلی
     ═══════════════════════════════════════════════════════════ */

  function initSmoothScroll() {
    const links = $$('a[href^="#"]');

    links.forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (!href || href === '#') return;

        const target = document.querySelector(href);
        if (!target) return;

        e.preventDefault();

        const header = $('#siteHeader');
        const headerHeight = header ? header.offsetHeight : 72;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - headerHeight - 16;

        // اگه کاربر کاهش انیمیشن خواسته، بدون اسکرول نرم
        if (prefersReducedMotion()) {
          window.scrollTo(0, targetPosition);
        } else {
          window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
          });
        }

        // آپدیت URL بدون رفرش
        history.pushState(null, '', href);
      });
    });
  }


  /* ═══════════════════════════════════════════════════════════
     ۵) انیمیشن ورود کارت‌ها (IntersectionObserver)
     ═══════════════════════════════════════════════════════════ */

  function initRevealAnimations() {
    // عناصری که باید انیمیشن ورود داشته باشن
    const selectors = [
      '.card',
      '.game-card',
      '.section-header',
      '.about-text',
      '.about-card'
    ];

    const elements = $$(selectors.join(', '));

    if (!elements.length) return;

    // اگه کاربر کاهش انیمیشن خواسته → همه رو مستقیم نشون بده
    if (prefersReducedMotion()) {
      elements.forEach(el => el.classList.add('visible'));
      return;
    }

    // اگه IntersectionObserver پشتیبانی نشد → همه رو نشون بده
    if (!('IntersectionObserver' in window)) {
      elements.forEach(el => el.classList.add('visible'));
      return;
    }

    // اضافه کردن کلاس پایه
    elements.forEach(el => el.classList.add('reveal'));

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            obs.unobserve(entry.target); // فقط یه بار
          }
        });
      },
      {
        threshold: 0.12,
        rootMargin: '0px 0px -60px 0px'
      }
    );

    elements.forEach(el => observer.observe(el));
  }


  /* ═══════════════════════════════════════════════════════════
     ۶) سال شمسی در فوتر
     ═══════════════════════════════════════════════════════════ */

  function initFooterYear() {
    const yearEl = $('#footerYear');
    if (!yearEl) return;

    try {
      const now = new Date();

      // گرفتن سال شمسی از تقویم فارسی مرورگر
      const faDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        year: 'numeric'
      }).format(now);

      // فقط عدد رو نگه دار
      const yearMatch = faDate.match(/\d+/);
      const year = yearMatch ? yearMatch[0] : '';

      // تبدیل ارقام لاتین به فارسی (اگه Intl فارسی نداد)
      const faYear = year
        .split('')
        .map(d => faDigits[+d] ?? d)
        .join('');

      yearEl.textContent = faYear || '۱۴۰۳';
    } catch (err) {
      // فالبک اگه Intl پشتیبانی نشد
      yearEl.textContent = '۱۴۰۳';
    }
  }


  /* ═══════════════════════════════════════════════════════════
     ۷) افکت پارالاکس ملایم روی اوروراها
     ═══════════════════════════════════════════════════════════ */

  function initAuroraParallax() {
    // روی موبایل غیرفعال باشه برای پرفورمنس
    if (isTouchDevice() || prefersReducedMotion()) return;

    const auroras = $$('.bg-aurora');
    if (!auroras.length) return;

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let rafId = null;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (!rafId) rafId = requestAnimationFrame(update);
    });

    function update() {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const dx = (mouseX - centerX) / centerX;
      const dy = (mouseY - centerY) / centerY;

      auroras.forEach((aurora, i) => {
        const intensity = (i + 1) * 8; // هر کدوم متفاوت
        aurora.style.setProperty('--px', `${dx * intensity}px`);
        aurora.style.setProperty('--py', `${dy * intensity}px`);
        aurora.style.transform = `translate(${dx * intensity}px, ${dy * intensity}px)`;
      });

      rafId = null;
    }
  }


  /* ═══════════════════════════════════════════════════════════
     ۸) افکت تیلت روی کارت‌ها (با ماوس)
     ═══════════════════════════════════════════════════════════ */

  function initCardTilt() {
    if (isTouchDevice() || prefersReducedMotion()) return;

    const cards = $$('.card, .game-card');

    cards.forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const rotateX = ((y - centerY) / centerY) * -3;
        const rotateY = ((x - centerX) / centerX) * 3;

        card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px)`;
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
      });
    });
  }


  /* ═══════════════════════════════════════════════════════════
     ۹) انیمیشن شمارنده آمار Hero
     ═══════════════════════════════════════════════════════════ */

  function initStatsCounter() {
    const stats = $$('.hero-stats .stat-value');
    if (!stats.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;

        const el = entry.target;
        const rawText = el.textContent.trim();

        // اگه متن غیرعددی بود (مثل ∞) → دست نزن
        if (!/^[0-9۰-۹]+$/.test(rawText) && rawText !== '+') {
          observer.unobserve(el);
          return;
        }

        // استخراج عدد و +
        const isPlus = rawText.includes('+');
        const numStr = rawText.replace(/[^0-9۰-۹]/g, '')
          .split('')
          .map(d => {
            const faIdx = faDigits.indexOf(d);
            return faIdx >= 0 ? faIdx : d;
          })
          .join('');

        const target = parseInt(numStr, 10);
        if (isNaN(target)) {
          observer.unobserve(el);
          return;
        }

        // انیمیشن شمارش
        let current = 0;
        const duration = 1200;
        const startTime = performance.now();

        const tick = (now) => {
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / duration, 1);
          // easing: easeOutQuint
          const eased = 1 - Math.pow(1 - progress, 5);
          current = Math.round(target * eased);
          el.textContent = toFa(current) + (isPlus ? '+' : '');
          if (progress < 1) requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
        observer.unobserve(el);
      });
    }, { threshold: 0.5 });

    stats.forEach(stat => observer.observe(stat));
  }


  /* ═══════════════════════════════════════════════════════════
     ۱۰) کرسر سفارشی (اختیاری — فقط دسکتاپ)
     ═══════════════════════════════════════════════════════════ */

  function initCustomCursor() {
    if (isTouchDevice() || prefersReducedMotion()) return;
    if (window.innerWidth < 1024) return;

    // ساخت عناصر کرسر
    const dot = document.createElement('div');
    const ring = document.createElement('div');

    dot.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 6px; height: 6px;
      background: #fff;
      border-radius: 50%;
      pointer-events: none;
      z-index: 99999;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 12px 3px rgba(167, 139, 250, 0.9);
      mix-blend-mode: screen;
      transition: opacity 0.2s;
      opacity: 0;
    `;

    ring.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 34px; height: 34px;
      border: 1.5px solid rgba(167, 139, 250, 0.6);
      border-radius: 50%;
      pointer-events: none;
      z-index: 99998;
      transform: translate(-50%, -50%);
      transition: width 0.25s ease, height 0.25s ease, border-color 0.25s ease, opacity 0.2s;
      opacity: 0;
    `;

    document.body.appendChild(dot);
    document.body.appendChild(ring);

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx, ry = my;
    let visible = false;

    const handleMove = (e) => {
      mx = e.clientX;
      my = e.clientY;

      if (!visible) {
        visible = true;
        dot.style.opacity = '1';
        ring.style.opacity = '1';
      }
    };

    document.addEventListener('mousemove', handleMove);

    document.addEventListener('mouseleave', () => {
      visible = false;
      dot.style.opacity = '0';
      ring.style.opacity = '0';
    });

    // حلقه نرم‌تر دنبال می‌کنه
    const animate = () => {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      requestAnimationFrame(animate);
    };
    animate();

    // بزرگ‌شدن روی عناصر تعاملی
    const interactive = document.querySelectorAll('a, button, .card, .game-card, input, .social-link');
    interactive.forEach(el => {
      el.addEventListener('mouseenter', () => {
        ring.style.width = '56px';
        ring.style.height = '56px';
        ring.style.borderColor = 'rgba(255, 95, 174, 0.9)';
      });
      el.addEventListener('mouseleave', () => {
        ring.style.width = '34px';
        ring.style.height = '34px';
        ring.style.borderColor = 'rgba(167, 139, 250, 0.6)';
      });
    });
  }


  /* ═══════════════════════════════════════════════════════════
     ۱۱) دکمه بازگشت به بالا (خودکار)
     ═══════════════════════════════════════════════════════════ */

  function initBackToTop() {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'بازگشت به بالا');
    btn.innerHTML = '↑';

    btn.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 24px;
      width: 48px;
      height: 48px;
      display: grid;
      place-items: center;
      font-size: 1.3rem;
      font-weight: 900;
      color: #fff;
      background: linear-gradient(135deg, #ff5fae, #a78bfa 50%, #22d3ee);
      border: 1.5px solid rgba(255, 255, 255, 0.25);
      border-radius: 50%;
      cursor: pointer;
      z-index: 90;
      box-shadow: 0 10px 30px -8px rgba(167, 139, 250, 0.9), 0 0 40px -10px rgba(255, 95, 174, 0.7);
      opacity: 0;
      transform: translateY(20px) scale(0.8);
      pointer-events: none;
      transition: opacity 0.3s ease, transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.4), box-shadow 0.3s;
      font-family: inherit;
    `;

    btn.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth'
      });
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-4px) scale(1.1)';
      btn.style.boxShadow = '0 16px 40px -8px rgba(167, 139, 250, 1), 0 0 60px -10px rgba(255, 95, 174, 1)';
    });

    btn.addEventListener('mouseleave', () => {
      if (window.scrollY > 500) {
        btn.style.transform = 'translateY(0) scale(1)';
      }
      btn.style.boxShadow = '0 10px 30px -8px rgba(167, 139, 250, 0.9), 0 0 40px -10px rgba(255, 95, 174, 0.7)';
    });

    document.body.appendChild(btn);

    const handleScroll = throttle(() => {
      const visible = window.scrollY > 600;
      if (visible) {
        btn.style.opacity = '1';
        btn.style.transform = 'translateY(0) scale(1)';
        btn.style.pointerEvents = 'auto';
      } else {
        btn.style.opacity = '0';
        btn.style.transform = 'translateY(20px) scale(0.8)';
        btn.style.pointerEvents = 'none';
      }
    }, 100);

    window.addEventListener('scroll', handleScroll, { passive: true });
  }


  /* ═══════════════════════════════════════════════════════════
     ۱۲) نوار پیشرفت اسکرول (بالای صفحه)
     ═══════════════════════════════════════════════════════════ */

  function initScrollProgress() {
    const bar = document.createElement('div');

    bar.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      height: 3px;
      width: 0%;
      z-index: 999;
      background: linear-gradient(90deg, #ff5fae, #a78bfa 40%, #22d3ee 70%, #a3e635);
      box-shadow: 0 0 12px rgba(167, 139, 250, 0.9);
      transition: width 0.1s linear;
      pointer-events: none;
    `;

    document.body.appendChild(bar);

    const update = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const percent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      bar.style.width = Math.min(100, Math.max(0, percent)) + '%';
    };

    update();
    window.addEventListener('scroll', throttle(update, 40), { passive: true });
    window.addEventListener('resize', throttle(update, 200));
  }


  /* ═══════════════════════════════════════════════════════════
     ۱۳) پیش‌بارگذاری صفحات مهم (Prefetch در زمان idle)
     ═══════════════════════════════════════════════════════════ */

  function initPrefetch() {
    const links = $$('.card, .game-card');
    if (!links.length) return;

    const prefetch = (url) => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      document.head.appendChild(link);
    };

    // با درخواست مرورگر
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (href && !href.startsWith('#')) prefetch(href);
        });
      }, { timeout: 3000 });
    } else {
      setTimeout(() => {
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (href && !href.startsWith('#')) prefetch(href);
        });
      }, 2000);
    }
  }


  /* ═══════════════════════════════════════════════════════════
     ۱۴) لاگ کنسول (فقط برای خودت)
     ═══════════════════════════════════════════════════════════ */

  function logSignature() {
    const styles = [
      'background: linear-gradient(135deg, #ff5fae, #a78bfa, #22d3ee)',
      'color: #fff',
      'padding: 10px 24px',
      'border-radius: 999px',
      'font-size: 14px',
      'font-weight: 900',
      'text-shadow: 0 2px 8px rgba(0,0,0,0.3)'
    ].join(';');

    console.log('%c✦ ساخته شده با 💜 ✦', styles);
    console.log(
      '%cسلام برنامه‌نویس کنجکاو! 👋\nاگه داری این رو می‌خونی یعنی آدم باحالی هستی.',
      'color: #a78bfa; font-size: 13px; line-height: 1.8;'
    );
  }


  /* ═══════════════════════════════════════════════════════════
     اجرای همه ماژول‌ها
     ═══════════════════════════════════════════════════════════ */

  function init() {
    try {
      initMobileMenu();
      initHeaderScroll();
      initActiveNav();
      initSmoothScroll();
      initRevealAnimations();
      initFooterYear();
      initAuroraParallax();
      initCardTilt();
      initStatsCounter();
      initCustomCursor();
      initBackToTop();
      initScrollProgress();
      initPrefetch();
      logSignature();
    } catch (err) {
      console.error('خطا در راه‌اندازی سایت:', err);
    }
  }

  // اگه DOM آماده بود → اجرا کن، وگرنه منتظر بمون
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


  /* ═══════════════════════════════════════════════════════════
     ۱۵) API عمومی برای دسترسی از بیرون (اختیاری)
     ═══════════════════════════════════════════════════════════ */

  window.Site = {
    version: '1.0.0',
    toFa,
    isTouchDevice,
    prefersReducedMotion,

    // اسکرول به یه بخش خاص
    scrollTo: (selector) => {
      const el = document.querySelector(selector);
      if (el) {
        const header = $('#siteHeader');
        const offset = header ? header.offsetHeight : 72;
        window.scrollTo({
          top: el.offsetTop - offset - 16,
          behavior: prefersReducedMotion() ? 'auto' : 'smooth'
        });
      }
    },

    // باز کردن منوی موبایل از بیرون
    openMenu: () => {
      const btn = $('#menuBtn');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
    },

    closeMenu: () => {
      const btn = $('#menuBtn');
      if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
    }
  };

})();
