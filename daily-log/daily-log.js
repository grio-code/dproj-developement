// ©HomeHub LLC 2026
(() => {
  'use strict';

  if (!window.firebase) return;

  if (!firebase.apps.length) {
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }

  const auth = firebase.auth();
  const db = firebase.firestore();
  const $ = id => document.getElementById(id);

  const CATEGORIES = [
    'Interior',
    'Exterior',
    'Site',
    'Other'
  ];

  const MAX_FILES = 30;
  const MAX_IMAGE_MB = 25;
  const MAX_VIDEO_MB = 500;
  const UPLOADS_AT_ONCE = 3;

  const NO_ACCESS_MSG =
    'You don’t have access to add daily logs. Ask a workspace admin to give you “Add daily logs” in Settings.';

  const fixedId =
    new URLSearchParams(location.search).get('project') || '';

  const st = {
    uid: '',
    wid: '',
    name: '',
    canLog: false,
    ready: false,
    busy: false,
    dirty: false,

    projects: [],
    project: null,
    files: [],
    ws: {},

    stage: 'open',

    logId:
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 6),

    wx: null,
    wxReq: 0,
    wxP: null,
    loc: null,
    locFor: ''
  };

  const pad = n =>
    String(n).padStart(2, '0');

  const ymd = d =>
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate());

  const projName = p =>
    p.name ||
    [
      p.lot && 'Lot ' + p.lot,
      p.community
    ]
      .filter(Boolean)
      .join(' · ') ||
    'Untitled project';

  const stageOf = p =>
    p.status === 'warranty' || p.status === 'closed'
      ? p.status
      : 'open';

  const mb = n =>
    n >= 1048576
      ? (n / 1048576).toFixed(1) + ' MB'
      : Math.max(1, Math.round(n / 1024)) + ' KB';

  function el(tag, cls, text) {
    const e = document.createElement(tag);

    if (cls) {
      e.className = cls;
    }

    if (text != null) {
      e.textContent = text;
    }

    return e;
  }

  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) {
      return false;
    }

    const d = new Date(s + 'T12:00');

    return (
      !isNaN(d) &&
      ymd(d) === s &&
      s <= ymd(new Date())
    );
  }

  function showMsg(text) {
    const m = $('dlMsg');

    m.textContent = text || '';
    m.hidden = !text;

    if (text) {
      m.scrollIntoView({
        block: 'center',
        behavior: 'smooth'
      });
    }
  }

  function setErr(id, text, input) {
    $(id).textContent = text || '';

    if (input) {
      if (text) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
    }
  }

  function lock(msg) {
    showMsg(msg);
    $('dlSave').disabled = true;
  }

  // ==========================================================
  // Shared dashboard sidebar
  // ==========================================================

  const sidebarProjName = p =>
    p.name ||
    [
      p.lot && 'Lot ' + p.lot,
      p.community
    ]
      .filter(Boolean)
      .join(' · ') ||
    'Untitled project';

  const sidebarStage = p =>
    p.status === 'warranty' || p.status === 'closed'
      ? p.status
      : 'open';

  function renderSidebar() {
    const name = st.ws.name || 'Workspace';

    $('dbWsName').textContent = name;

    const logo = $('dbWsLogo');

    logo.textContent = '';

    if (st.ws.logo) {
      const img = new Image();

      img.alt = '';
      img.src = st.ws.logo;

      logo.appendChild(img);
    } else {
      logo.textContent =
        name.trim().charAt(0).toUpperCase();
    }

    const q =
      ($('projSearch').value || '')
        .trim()
        .toLowerCase();

    const found =
      !q
        ? st.projects
        : st.projects.filter(p =>
            [
              sidebarProjName(p),
              p.address,
              p.community,
              p.lot
            ]
              .join(' ')
              .toLowerCase()
              .includes(q)
          );

    ['open', 'warranty', 'closed'].forEach(k => {
      const id =
        'stage' +
        k.charAt(0).toUpperCase() +
        k.slice(1) +
        'N';

      $(id).textContent =
        found.filter(
          p => sidebarStage(p) === k
        ).length || '';
    });

    document
      .querySelectorAll('#projStage [data-stage]')
      .forEach(b => {
        b.setAttribute(
          'aria-pressed',
          String(b.dataset.stage === st.stage)
        );
      });

    const ul = $('dbSideProjects');

    ul.textContent = '';

    const list =
      found.filter(
        p => sidebarStage(p) === st.stage
      );

    if (!list.length) {
      const msg =
        q
          ? 'No ' +
            st.stage +
            ' projects match “' +
            q +
            '”.'
          : 'No ' +
            st.stage +
            ' projects.';

      ul.appendChild(
        el('li', 'db-empty', msg)
      );

      return;
    }

    list
      .sort((a, b) =>
        sidebarProjName(a).localeCompare(
          sidebarProjName(b)
        )
      )
      .forEach(p => {
        const li = el('li');
        const a = el('a');

        a.href =
          'index.html#projects/' +
          encodeURIComponent(p.id) +
          '/details';

        a.dataset.pid = p.id;

        a.append(
          el(
            'b',
            null,
            sidebarProjName(p)
          ),

          el(
            'span',
            'addr',
            p.address ||
              [
                p.lot && 'Lot ' + p.lot,
                p.community
              ]
                .filter(Boolean)
                .join(', ') ||
              'No address yet'
          )
        );

        li.appendChild(a);
        ul.appendChild(li);
      });
  }

  function setupSidebar() {
    $('dbAdd').addEventListener(
      'click',
      e => {
        e.stopPropagation();

        const menu = $('dbAddMenu');

        const open =
          !menu.classList.contains(
            'is-open'
          );

        menu.classList.toggle(
          'is-open',
          open
        );

        $('dbAdd').setAttribute(
          'aria-expanded',
          String(open)
        );
      }
    );

    document.addEventListener(
      'click',
      e => {
        const menu = $('dbAddMenu');

        if (!menu.contains(e.target)) {
          menu.classList.remove(
            'is-open'
          );

          $('dbAdd').setAttribute(
            'aria-expanded',
            'false'
          );
        }
      }
    );

    document.addEventListener(
      'keydown',
      e => {
        if (e.key === 'Escape') {
          $('dbAddMenu').classList.remove(
            'is-open'
          );

          $('dbAdd').setAttribute(
            'aria-expanded',
            'false'
          );
        }
      }
    );

    $('projSearch').addEventListener(
      'input',
      renderSidebar
    );

    $('projStage').addEventListener(
      'click',
      e => {
        const b =
          e.target.closest(
            '[data-stage]'
          );

        if (!b) return;

        st.stage = b.dataset.stage;

        try {
          sessionStorage.setItem(
            'hh-proj-stage',
            st.stage
          );
        } catch (ex) {}

        renderSidebar();
      }
    );

    try {
      const saved =
        sessionStorage.getItem(
          'hh-proj-stage'
        );

      if (
        [
          'open',
          'warranty',
          'closed'
        ].includes(saved)
      ) {
        st.stage = saved;
      }
    } catch (ex) {}
  }

  setupSidebar();

  // ==========================================================
  // Page setup
  // ==========================================================

  $('dlDate').value =
    ymd(new Date());

  $('dlDate').max =
    ymd(new Date());

  CATEGORIES.forEach(c => {
    const o = el(
      'option',
      null,
      c
    );

    o.value = c;

    $('dlCat').appendChild(o);
  });

  if (fixedId) {
    const back =
      'index.html#projects/' +
      encodeURIComponent(fixedId) +
      '/details';

    $('dlBack').href = back;
    $('dlCancel').href = back;

    $('dlBack').textContent =
      '‹ Back to project';
  }

  // ==========================================================
  // Weather
  // ==========================================================

  const useF =
    /^en-(US|LR|MM)|^(my|lr)/i.test(
      navigator.language || 'en-US'
    );

  function wxDesc(code) {
    if (code === 0) return 'Clear';
    if (code === 1) return 'Mostly clear';
    if (code === 2) return 'Partly cloudy';
    if (code === 3) return 'Cloudy';
    if (code === 45 || code === 48) return 'Foggy';

    if (
      code >= 51 &&
      code <= 57
    ) {
      return 'Drizzle';
    }

    if (
      (code >= 61 &&
        code <= 67) ||
      (code >= 80 &&
        code <= 82)
    ) {
      return 'Rain';
    }

    if (
      (code >= 71 &&
        code <= 77) ||
      code === 85 ||
      code === 86
    ) {
      return 'Snow';
    }

    if (code >= 95) {
      return 'Thunderstorms';
    }

    return '';
  }

  const savedKey = () =>
    'hh-site-loc-' +
    (st.project
      ? st.project.id
      : '');

  function readSaved() {
    try {
      const v =
        JSON.parse(
          localStorage.getItem(
            savedKey()
          ) || 'null'
        );

      return (
        v &&
        isFinite(v.lat) &&
        isFinite(v.lon)
          ? v
          : null
      );
    } catch (e) {
      return null;
    }
  }

  function writeSaved(loc) {
    try {
      localStorage.setItem(
        savedKey(),
        JSON.stringify({
          lat: loc.lat,
          lon: loc.lon
        })
      );
    } catch (e) {}
  }

  function locate() {
    const saved =
      readSaved();

    const fallback = () =>
      saved
        ? {
            lat: saved.lat,
            lon: saved.lon,
            source: 'saved'
          }
        : null;

    if (!navigator.geolocation) {
      return Promise.resolve(
        fallback()
      );
    }

    return new Promise(
      resolve => {
        navigator.geolocation.getCurrentPosition(
          pos => {
            const loc = {
              lat:
                pos.coords.latitude,
              lon:
                pos.coords.longitude
            };

            writeSaved(loc);

            resolve(
              Object.assign(
                loc,
                {
                  source:
                    'device'
                }
              )
            );
          },

          () =>
            resolve(
              fallback()
            ),

          {
            maximumAge:
              30 * 6e4,
            timeout: 10000
          }
        );
      }
    );
  }

  async function fetchWeather(
    loc,
    date
  ) {
    const age =
      Math.round(
        (
          Date.parse(
            ymd(new Date()) +
              'T12:00'
          ) -
          Date.parse(
            date +
              'T12:00'
          )
        ) /
          864e5
      );

    const base =
      age > 90
        ? 'https://archive-api.open-meteo.com/v1/archive'
        : 'https://api.open-meteo.com/v1/forecast';

    const q =
      new URLSearchParams({
        latitude:
          loc.lat.toFixed(3),

        longitude:
          loc.lon.toFixed(3),

        start_date:
          date,

        end_date:
          date,

        timezone:
          'auto',

        daily:
          'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max'
      });

    if (useF) {
      q.set(
        'temperature_unit',
        'fahrenheit'
      );

      q.set(
        'wind_speed_unit',
        'mph'
      );

      q.set(
        'precipitation_unit',
        'inch'
      );
    }

    const r =
      await fetch(
        base +
          '?' +
          q
      );

    if (!r.ok) {
      throw new Error(
        'weather ' +
          r.status
      );
    }

    const d =
      (await r.json())
        .daily;

    if (
      !d ||
      !d.time ||
      !d.time.length
    ) {
      throw new Error(
        'no weather data'
      );
    }

    const num = a => {
      const v =
        a &&
        a[0];

      return typeof v ===
        'number' &&
        isFinite(v)
        ? Math.round(
            v * 10
          ) / 10
        : null;
    };

    const code =
      num(
        d.weather_code
      );

    const w = {
      code,

      desc:
        code == null
          ? ''
          : wxDesc(
              code
            ),

      hi:
        num(
          d.temperature_2m_max
        ),

      lo:
        num(
          d.temperature_2m_min
        ),

      precip:
        num(
          d.precipitation_sum
        ),

      wind:
        num(
          d.wind_speed_10m_max
        ),

      tempUnit:
        useF
          ? 'F'
          : 'C',

      precipUnit:
        useF
          ? 'in'
          : 'mm',

      windUnit:
        useF
          ? 'mph'
          : 'km/h',

      lat:
        Math.round(
          loc.lat * 100
        ) / 100,

      lon:
        Math.round(
          loc.lon * 100
        ) / 100,

      source:
        loc.source
    };

    if (
      w.code == null &&
      w.hi == null &&
      w.lo == null
    ) {
      throw new Error(
        'no weather data'
      );
    }

    return w;
  }

  function wxLine(w) {
    const t =
      n =>
        Math.round(n) +
        '°' +
        w.tempUnit;

    return [
      w.desc,

      w.hi != null &&
      w.lo != null
        ? 'High ' +
          t(w.hi) +
          ', low ' +
          t(w.lo)
        : '',

      w.precip != null
        ? w.precip > 0
          ? w.precip +
            ' ' +
            w.precipUnit +
            ' precipitation'
          : 'No precipitation'
        : '',

      w.wind != null
        ? 'Wind up to ' +
          Math.round(
            w.wind
          ) +
          ' ' +
          w.windUnit
        : ''
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function showWeather(w) {
    const box =
      $('dlWx');

    box.textContent =
      '';

    if (
      w.hi != null
    ) {
      box.appendChild(
        el(
          'b',
          null,
          Math.round(
            w.hi
          ) +
            '°'
        )
      );
    }

    box.appendChild(
      document.createTextNode(
        wxLine(w)
      )
    );

    box.appendChild(
      el(
        'p',
        'f-hint',
        w.source ===
        'saved'
          ? 'Using the last location this device shared for this project.'
          : 'Based on this device’s location.'
      )
    );
  }

  function refreshWeather() {
    const box =
      $('dlWx');

    const retry =
      $('dlWxRetry');

    const date =
      $('dlDate')
        .value;

    st.wx =
      null;

    retry.hidden =
      true;

    if (
      !st.project ||
      !validDate(date)
    ) {
      st.wxReq++;

      box.textContent =
        'Choose a project and a date to see the weather.';

      return Promise.resolve();
    }

    const req =
      ++st.wxReq;

    box.textContent =
      'Getting the weather…';

    st.wxP =
      (async () => {
        if (
          st.locFor !==
          st.project.id
        ) {
          st.loc =
            await locate();

          st.locFor =
            st.project.id;
        }

        if (
          req !==
          st.wxReq
        ) {
          return;
        }

        if (!st.loc) {
          throw new Error(
            'no-location'
          );
        }

        const w =
          await fetchWeather(
            st.loc,
            date
          );

        if (
          req !==
          st.wxReq
        ) {
          return;
        }

        st.wx =
          w;

        showWeather(
          w
        );
      })().catch(
        ex => {
          if (
            req !==
            st.wxReq
          ) {
            return;
          }

          console.warn(
            'Weather unavailable',
            ex
          );

          box.textContent =
            ex &&
            ex.message ===
              'no-location'
              ? 'Couldn’t find your location. Allow location access in your browser to add the weather.'
              : 'The weather isn’t available right now.';

          retry.hidden =
            false;
        }
      );

    return st.wxP;
  }

  $('dlWxRetry').addEventListener(
    'click',
    () => {
      st.locFor = '';
      refreshWeather();
    }
  );

  $('dlDate').addEventListener(
    'change',
    () => {
      setErr(
        'dlDateErr',
        '',
        $('dlDate')
      );

      refreshWeather();
    }
  );

  // ==========================================================
  // The project
  // ==========================================================

  function projectChosen(p) {
    st.project =
      p;

    const ca =
      (p &&
        p.clientAccess) ||
      {};

    const off =
      ca.portal === false ||
      ca.dailyLogs === false;

    $('dlClientNote').textContent =
      'Add at least one. ' +
      (
        off
          ? 'Client access to daily logs is turned off for this project, so clients won’t see these photos and videos until it’s switched on under Client information.'
          : 'Photos and videos on a daily log are marked to be shared with the project’s clients.'
      );

    refreshWeather();
  }

  async function loadProjects() {
    if (fixedId) {
      let p = null;

      try {
        const s =
          await db
            .doc(
              'projects/' +
                fixedId
            )
            .get();

        if (s.exists) {
          p =
            Object.assign(
              {
                id:
                  s.id
              },
              s.data()
            );
        }
      } catch (e) {
        console.warn(e);
      }

      if (
        !p ||
        p.workspaceId !==
          st.wid ||
        p.archived
      ) {
        lock(
          'That project was not found. It may have been archived or deleted.'
        );

        return;
      }

      $('dlProjectPick').hidden =
        true;

      $('dlProjectFixed').hidden =
        false;

      $('dlProjectFixedName').textContent =
        projName(p);

      projectChosen(
        p
      );

      return;
    }

    const snap =
      await db
        .collection(
          'projects'
        )
        .where(
          'workspaceId',
          '==',
          st.wid
        )
        .get();

    st.projects =
      snap.docs
        .map(
          d =>
            Object.assign(
              {
                id:
                  d.id
              },
              d.data()
            )
        )
        .filter(
          p =>
            !p.archived &&
            stageOf(p) ===
              'open'
        )
        .sort(
          (a, b) =>
            projName(a).localeCompare(
              projName(b)
            )
        );

    const sel =
      $('dlProject');

    sel.textContent =
      '';

    const first =
      el(
        'option',
        null,
        st.projects.length
          ? 'Choose a project…'
          : 'No open projects'
      );

    first.value =
      '';

    sel.appendChild(
      first
    );

    st.projects.forEach(
      p => {
        const o =
          el(
            'option',
            null,
            projName(p)
          );

        o.value =
          p.id;

        sel.appendChild(
          o
        );
      }
    );

    sel.disabled =
      !st.projects.length;

    if (
      !st.projects.length
    ) {
      lock(
        'There are no open projects to log against yet. Create a project first.'
      );
    }
  }

  $('dlProject').addEventListener(
    'change',
    e => {
      setErr(
        'dlProjectErr',
        '',
        e.target
      );

      projectChosen(
        st.projects.find(
          p =>
            p.id ===
            e.target.value
        ) || null
      );
    }
  );

  // ==========================================================
  // Photos and videos
  // ==========================================================

  const EXT = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',

    mp4: 'video/mp4',
    m4v: 'video/x-m4v',
    mov: 'video/quicktime',
    webm: 'video/webm',
    '3gp': 'video/3gpp'
  };

  function typeOf(file) {
    if (
      /^(image|video)\//.test(
        file.type
      )
    ) {
      return file.type;
    }

    return (
      EXT[
        (
          file.name
            .split('.')
            .pop() ||
          ''
        ).toLowerCase()
      ] || ''
    );
  }

  function addFiles(list) {
    const cat =
      $('dlCat').value;

    if (!cat) {
      setErr(
        'dlFilesErr',
        'Choose a category first, then add your photos and videos.'
      );

      $('dlCat').focus();

      return;
    }

    const problems =
      [];

    let full =
      false;

    Array.from(list).forEach(
      file => {
        const ct =
          typeOf(file);

        const kind =
          ct.startsWith(
            'image/'
          )
            ? 'image'
            : ct.startsWith(
                'video/'
              )
              ? 'video'
              : '';

        if (
          !kind ||
          !file.size
        ) {
          problems.push(
            file.name +
              ' isn’t a photo or video.'
          );

          return;
        }

        const cap =
          kind ===
          'image'
            ? MAX_IMAGE_MB
            : MAX_VIDEO_MB;

        if (
          file.size >=
          cap *
            1048576
        ) {
          problems.push(
            file.name +
              ' is too large. ' +
              (
                kind ===
                'image'
                  ? 'Photos'
                  : 'Videos'
              ) +
              ' can be up to ' +
              cap +
              ' MB.'
          );

          return;
        }

        if (
          st.files.some(
            f =>
              f.file.name ===
                file.name &&
              f.file.size ===
                file.size &&
              f.file.lastModified ===
                file.lastModified
          )
        ) {
          return;
        }

        if (
          st.files.length >=
          MAX_FILES
        ) {
          full =
            true;

          return;
        }

        st.files.push({
          id:
            Math.random()
              .toString(36)
              .slice(
                2,
                8
              ),

          file,

          kind,

          contentType:
            ct,

          category:
            cat,

          url:
            URL.createObjectURL(
              file
            ),

          uploaded:
            null,

          progress:
            0,

          el:
            null
        });
      }
    );

    if (full) {
      problems.push(
        'A log can hold up to ' +
          MAX_FILES +
          ' photos and videos.'
      );
    }

    setErr(
      'dlFilesErr',
      problems.join(' ')
    );

    st.dirty =
      true;

    renderFiles();
  }

  function fileCard(it) {
    const li =
      el(
        'li',
        'dl-file' +
          (
            it.uploaded
              ? ' is-done'
              : ''
          )
      );

    it.el =
      li;

    const th =
      el(
        'div',
        'dl-thumb'
      );

    if (
      it.kind ===
      'image'
    ) {
      const img =
        el(
          'img'
        );

      img.src =
        it.url;

      img.alt =
        '';

      img.loading =
        'lazy';

      th.appendChild(
        img
      );
    } else {
      const v =
        el(
          'video'
        );

      v.src =
        it.url +
        '#t=0.1';

      v.preload =
        'metadata';

      v.muted =
        true;

      v.playsInline =
        true;

      th.appendChild(
        v
      );
    }

    th.appendChild(
      el(
        'span',
        'dl-kind',
        it.kind ===
          'image'
          ? 'Photo'
          : 'Video'
      )
    );

    const sel =
      el(
        'select'
      );

    sel.setAttribute(
      'aria-label',
      'Category for ' +
        it.file.name
    );

    CATEGORIES.forEach(
      c => {
        const o =
          el(
            'option',
            null,
            c
          );

        o.value =
          c;

        sel.appendChild(
          o
        );
      }
    );

    sel.value =
      it.category;

    sel.addEventListener(
      'change',
      () => {
        it.category =
          sel.value;

        st.dirty =
          true;
      }
    );

    const rm =
      el(
        'button',
        'btn btn--quiet',
        'Remove'
      );

    rm.type =
      'button';

    rm.setAttribute(
      'aria-label',
      'Remove ' +
        it.file.name
    );

    rm.addEventListener(
      'click',
      () => {
        const i =
          st.files.indexOf(
            it
          );

        if (
          i < 0
        ) {
          return;
        }

        URL.revokeObjectURL(
          it.url
        );

        st.files.splice(
          i,
          1
        );

        renderFiles();

        const next =
          $('dlFiles')
            .querySelectorAll(
              '.btn'
            )[
              Math.min(
                i,
                st.files.length -
                  1
              )
            ];

        (
          next ||
          $('dlPick')
        ).focus();
      }
    );

    li.append(
      th,

      el(
        'p',
        'dl-file-name',
        it.file.name
      ),

      el(
        'p',
        'dl-file-meta',
        mb(it.file.size)
      ),

      sel,

      rm
    );

    return li;
  }

  function renderFiles() {
    const ul =
      $('dlFiles');

    ul.textContent =
      '';

    st.files.forEach(
      it =>
        ul.appendChild(
          fileCard(it)
        )
    );

    const photos =
      st.files.filter(
        f =>
          f.kind ===
          'image'
      ).length;

    const videos =
      st.files.length -
      photos;

    $('dlCount').textContent =
      st.files.length
        ? [
            photos &&
              photos +
                (
                  photos ===
                  1
                    ? ' photo'
                    : ' photos'
                ),

            videos &&
              videos +
                (
                  videos ===
                  1
                    ? ' video'
                    : ' videos'
                )
          ]
            .filter(Boolean)
            .join(', ') +
            ' added'
        : '';

    if (
      st.files.length &&
      $('dlFilesErr').textContent ===
        'Add at least one photo or video.'
    ) {
      setErr(
        'dlFilesErr',
        ''
      );
    }
  }

  $('dlPick').addEventListener(
    'click',
    () => {
      if (
        !$('dlCat').value
      ) {
        setErr(
          'dlFilesErr',
          'Choose a category first, then add your photos and videos.'
        );

        $('dlCat').focus();

        return;
      }

      $('dlInput').click();
    }
  );

  $('dlCat').addEventListener(
    'change',
    () => {
      if (
        $('dlCat').value
      ) {
        setErr(
          'dlFilesErr',
          ''
        );
      }
    }
  );

  $('dlInput').addEventListener(
    'change',
    e => {
      addFiles(
        e.target.files
      );

      e.target.value =
        '';
    }
  );

  // ==========================================================
  // Check, upload, save
  // ==========================================================

  function validate() {
    let bad =
      null;

    const need = (
      id,
      errId,
      msg
    ) => {
      const i =
        $(id);

      const ok =
        !!i.value.trim();

      setErr(
        errId,
        ok
          ? ''
          : msg,
        i
      );

      if (!ok) {
        bad =
          bad ||
          i;
      }
    };

    if (
      fixedId
        ? !st.project
        : !$('dlProject').value
    ) {
      setErr(
        'dlProjectErr',
        'Choose a project.',
        $('dlProject')
      );

      bad =
        bad ||
        $('dlProject');
    } else {
      setErr(
        'dlProjectErr',
        '',
        $('dlProject')
      );
    }

    const date =
      $('dlDate').value;

    const dateOk =
      validDate(
        date
      );

    setErr(
      'dlDateErr',
      dateOk
        ? ''
        : date &&
            date >
              ymd(
                new Date()
              )
          ? 'The date can’t be in the future.'
          : 'Choose the date.',
      $('dlDate')
    );

    if (!dateOk) {
      bad =
        bad ||
        $('dlDate');
    }

    need(
      'dlTitle',
      'dlTitleErr',
      'Give the log a title, like “Framing work”.'
    );

    need(
      'dlOnSite',
      'dlOnSiteErr',
      'List who was on site.'
    );

    if (
      !st.files.length
    ) {
      setErr(
        'dlFilesErr',
        'Add at least one photo or video.'
      );

      bad =
        bad ||
        $('dlCat');
    }

    need(
      'dlProgress',
      'dlProgressErr',
      'Describe the progress made today.'
    );

    need(
      'dlIssues',
      'dlIssuesErr',
      'Note any issues, or write “None”.'
    );

    need(
      'dlOther',
      'dlOtherErr',
      'Add anything else worth noting, or write “None”.'
    );

    return bad;
  }

  function setBusy(on) {
    st.busy =
      on;

    Array.from(
      $('dlForm').elements
    ).forEach(
      e => {
        e.disabled =
          on;
      }
    );

    $('dlSave').textContent =
      on
        ? 'Submitting…'
        : 'Submit daily log';

    $('dlCancel').setAttribute(
      'aria-disabled',
      String(on)
    );

    $('dlCancel').style.pointerEvents =
      on
        ? 'none'
        : '';

    $('dlProg').hidden =
      !on;
  }

  function showProgress(
    text,
    pct
  ) {
    $('dlProgText').textContent =
      text;

    $('dlProgFill').style.width =
      pct +
      '%';

    $('dlProgBar').setAttribute(
      'aria-valuenow',
      String(
        Math.round(
          pct
        )
      )
    );
  }

  // ==========================================================
  // IMPORTANT:
  // Firebase Storage UploadTask is explicitly wrapped in a
  // Promise. This prevents the submit process from getting
  // stuck while the upload is running.
  // ==========================================================

  async function uploadOne(it) {
    const safe =
      (
        it.file.name.replace(
          /[^\w.\-]+/g,
          '_'
        )
        .slice(
          -80
        )
      ) ||
      'file';

    const path =
      'workspaces/' +
      st.wid +
      '/projects/' +
      st.project.id +
      '/dailyLogs/' +
      st.logId +
      '/' +
      it.id +
      '-' +
      safe;

    const ref =
      firebase
        .storage()
        .ref(
          path
        );

    await new Promise(
      (
        resolve,
        reject
      ) => {
        const task =
          ref.put(
            it.file,
            {
              contentType:
                it.contentType,

              customMetadata:
                {
                  category:
                    it.category
                }
            }
          );

        task.on(
          'state_changed',

          // ------------------------------
          // Upload progress
          // ------------------------------
          snapshot => {
            it.progress =
              snapshot.totalBytes
                ? snapshot.bytesTransferred /
                  snapshot.totalBytes
                : 0;

            overall();
          },

          // ------------------------------
          // Upload failed
          // ------------------------------
          error => {
            if (it.el) {
              it.el.classList.add(
                'is-failed'
              );

              it.el.classList.remove(
                'is-done'
              );
            }

            reject(
              error
            );
          },

          // ------------------------------
          // Upload completed
          // ------------------------------
          () => {
            resolve();
          }
        );
      }
    );

    // Only get the download URL AFTER
    // Firebase confirms the upload finished.
    const url =
      await ref.getDownloadURL();

    it.uploaded = {
      path,
      url
    };

    it.progress =
      1;

    if (it.el) {
      it.el.classList.add(
        'is-done'
      );

      it.el.classList.remove(
        'is-failed'
      );
    }

    overall();
  }

  function overall() {
    const n =
      st.files.length;

    const sum =
      st.files.reduce(
        (s, f) =>
          s +
          (
            f.uploaded
              ? 1
              : f.progress
          ),
        0
      );

    const done =
      st.files.filter(
        f =>
          f.uploaded
      ).length;

    showProgress(
      'Uploading photos and videos… ' +
        done +
        ' of ' +
        n +
        ' done',

      n
        ? (sum / n) *
            95
        : 0
    );
  }

  async function uploadAll() {
    const todo =
      st.files.filter(
        f =>
          !f.uploaded
      );

    let failed =
      null;

    const worker =
      async () => {
        while (
          !failed &&
          todo.length
        ) {
          const it =
            todo.shift();

          try {
            await uploadOne(
              it
            );
          } catch (ex) {
            failed =
              failed ||
              ex;

            if (
              it.el
            ) {
              it.el.classList.add(
                'is-failed'
              );
            }
          }
        }
      };

    await Promise.all(
      Array.from(
        {
          length:
            Math.min(
              UPLOADS_AT_ONCE,
              todo.length
            )
        },
        worker
      )
    );

    if (failed) {
      throw failed;
    }
  }

  function friendly(ex) {
    const c =
      ex &&
      ex.code ||
      '';

    if (
      c ===
        'permission-denied' ||
      c ===
        'storage/unauthorized'
    ) {
      return (
        'Couldn’t submit the log: permission denied. Ask an admin to give you “Add daily logs” in Settings, and make sure the Firestore and Storage rules are published.'
      );
    }

    if (
      c ===
      'storage/unauthenticated'
    ) {
      return (
        'You’ve been signed out. Sign in again, then submit the log.'
      );
    }

    if (
      c ===
      'storage/quota-exceeded'
    ) {
      return (
        'Couldn’t upload: this workspace’s file storage is full.'
      );
    }

    return (
      'Couldn’t submit the log. Check your connection and try again. Files that already uploaded won’t be sent twice.'
    );
  }

  // ==========================================================
  // Submit daily log
  // ==========================================================

  $('dlForm').addEventListener(
    'submit',
    async e => {
      e.preventDefault();

      if (
        st.busy
      ) {
        return;
      }

      showMsg('');

      if (
        !st.ready
      ) {
        return showMsg(
          'Still checking your account. Try again in a moment.'
        );
      }

      if (
        !st.canLog
      ) {
        return showMsg(
          NO_ACCESS_MSG
        );
      }

      const bad =
        validate();

      if (bad) {
        bad.focus();
        return;
      }

      if (
        !firebase.storage
      ) {
        return showMsg(
          'Photo and video upload didn’t load. Refresh the page and try again.'
        );
      }

      setBusy(
        true
      );

      showProgress(
        'Getting ready…',
        0
      );

      try {
        // Wait for weather if it is already loading.
        // If weather failed, try once more.
        if (
          st.wxP
        ) {
          await st.wxP;
        }

        if (
          !st.wx
        ) {
          await refreshWeather();
        }

        // Upload all photos/videos.
        await uploadAll();

        // At this point every media item has a
        // Firebase Storage URL.
        showProgress(
          'Saving the log…',
          97
        );

        const ref =
          db.doc(
            'projects/' +
              st.project.id +
              '/dailyLogs/' +
              st.logId
          );

        const doc = {
          workspaceId:
            st.wid,

          projectId:
            st.project.id,

          projectName:
            projName(
              st.project
            ).slice(
              0,
              120
            ),

          date:
            $('dlDate')
              .value,

          title:
            $('dlTitle')
              .value
              .trim(),

          onSite:
            $('dlOnSite')
              .value
              .trim(),

          progress:
            $('dlProgress')
              .value
              .trim(),

          issues:
            $('dlIssues')
              .value
              .trim(),

          other:
            $('dlOther')
              .value
              .trim(),

          media:
            st.files.map(
              f => ({
                path:
                  f.uploaded
                    .path,

                url:
                  f.uploaded
                    .url,

                name:
                  f.file.name.slice(
                    0,
                    120
                  ),

                type:
                  f.kind,

                contentType:
                  f.contentType,

                size:
                  f.file.size,

                category:
                  f.category,

                clientVisible:
                  true
              })
            ),

          weather:
            st.wx ||
            null,

          createdAt:
            new Date().toISOString(),

          createdBy:
            st.uid,

          createdByName:
            (
              st.name ||
              ''
            ).slice(
              0,
              120
            )
        };

        // Save the actual Daily Log document.
        try {
          await ref.set(
            doc
          );
        } catch (ex) {
          // If the network dropped after Firestore
          // accepted the write, check whether it exists.
          let saved =
            false;

          try {
            saved =
              (
                await ref.get()
              ).exists;
          } catch (e2) {}

          if (!saved) {
            throw ex;
          }
        }

        // Everything succeeded.
        st.dirty =
          false;

        st.busy =
          false;

        try {
          sessionStorage.setItem(
            'hh-after-log',
            st.project.id
          );
        } catch (ex) {}

        showProgress(
          'Saved.',
          100
        );

        // Return to the project page.
        location.href =
          'index.html#projects/' +
          encodeURIComponent(
            st.project.id
          ) +
          '/details';

      } catch (ex) {
        console.error(
          'Daily log submission failed:',
          ex
        );

        setBusy(
          false
        );

        showMsg(
          friendly(
            ex
          )
        );
      }
    }
  );

  // ==========================================================
  // Don't lose a half-written log by accident
  // ==========================================================

  $('dlForm').addEventListener(
    'input',
    () => {
      st.dirty =
        true;
    }
  );

  window.addEventListener(
    'beforeunload',
    e => {
      if (
        st.busy ||
        st.dirty
      ) {
        e.preventDefault();
        e.returnValue =
          '';
      }
    }
  );

  // ==========================================================
  // Who is signed in, and may they add daily logs?
  // ==========================================================

  auth.onAuthStateChanged(
    async user => {
      if (!user) {
        location.replace(
          'login.html'
        );

        return;
      }

      try {
        const p =
          await db
            .doc(
              'users/' +
                user.uid +
                '/profile/info'
            )
            .get();

        const prof =
          p.exists
            ? p.data()
            : {};

        if (
          !prof.workspaceId ||
          !prof.username
        ) {
          location.replace(
            'signup.html'
          );

          return;
        }

        st.uid =
          user.uid;

        st.wid =
          prof.workspaceId;

        const [
          w,
          m
        ] =
          await Promise.all([
            db
              .doc(
                'workspaces/' +
                  st.wid
              )
              .get(),

            db
              .doc(
                'workspaces/' +
                  st.wid +
                  '/members/' +
                  user.uid
              )
              .get()
          ]);

        st.ws =
          w.exists
            ? w.data()
            : {};

        const me =
          m.exists
            ? m.data()
            : {};

        st.name =
          me.displayName ||
          prof.username ||
          user.email ||
          '';

        const isAdmin =
          (
            w.exists &&
            w.data()
              .ownerId ===
              user.uid
          ) ||
          me.admin ===
            true;

        const perm =
          window.HH_PERMS
            ? window.HH_PERMS.of(
                me,
                isAdmin
              )
            : {};

        st.canLog =
          !!perm.addDailyLogs;

        if (
          !st.canLog
        ) {
          lock(
            NO_ACCESS_MSG
          );

          $('dlProject').disabled =
            true;

          st.ready =
            true;

          return;
        }

        await loadProjects();

        // Populate the same project data
        // used by the dashboard sidebar.
        renderSidebar();

        st.ready =
          true;

      } catch (ex) {
        console.error(
          ex
        );

        showMsg(
          'Couldn’t load your workspace. Refresh to try again.'
        );
      }
    }
  );
})();