const toDateStr = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const formatDate = (dateStr) => {
  if (!dateStr) return "—";
  const [year, month, day] = dateStr.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
};

const formatShortDate = (dateStr) => {
  if (!dateStr) return "—";
  const [, month, day] = dateStr.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(month, 10) - 1]} ${parseInt(day, 10)}`;
};

const THEMES = {
  default:    { bg: "#ffffff", border: "#e4e2e2", value: "#333333", label: "#777777", accent: "#ffa657", circleAccent: "#ffa657" },
  tokyonight: { bg: "#1a1b27", border: "#414868", value: "#38bdae", label: "#a9b1d6", accent: "#ff9e64", circleAccent: "#ff9e64" },
  dark:       { bg: "#161b22", border: "#30363d", value: "#58a6ff", label: "#8b949e", accent: "#58a6ff", circleAccent: "#ff9e64" },
  radical:    { bg: "#141321", border: "#fe428e", value: "#a9fef7", label: "#f8d847", accent: "#fe428e", circleAccent: "#fe428e" },
};

const graphql = async (token, query, variables) => {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
};

const fetchContributions = async (username, token) => {
  const profileData = await graphql(token, `
    query($username: String!) {
      user(login: $username) { createdAt }
    }
  `, { username });

  const createdYear = new Date(profileData.user.createdAt).getFullYear();
  const currentYear = new Date().getFullYear();

  const yearQuery = `
    query($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const yearRequests = [];
  for (let year = createdYear; year <= currentYear; year++) {
    yearRequests.push(
      graphql(token, yearQuery, {
        username,
        from: `${year}-01-01T00:00:00Z`,
        to: `${year}-12-31T23:59:59Z`,
      })
    );
  }

  const results = await Promise.all(yearRequests);

  const map = new Map();
  for (const data of results) {
    for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) {
        const prev = map.get(day.date) ?? 0;
        if (day.contributionCount > prev) map.set(day.date, day.contributionCount);
      }
    }
  }

  return Array.from(map.entries()).map(([date, count]) => ({ date, count }));
};

const calculateStreak = (days) => {
  const today = toDateStr(new Date());
  const byDate = new Map(days.map(d => [d.date, d.count]));
  const sortedKeys = [...byDate.keys()].sort();
  const earliest = sortedKeys[0] ?? today;
  const lastDataDate = sortedKeys[sortedKeys.length - 1] ?? today;

  const [ly, lm, ld] = lastDataDate.split("-").map(Number);
  const base = new Date(ly, lm - 1, ld);

  let currentStreak = 0;
  let streakStart = null;
  let streakEnd = null;
  let consecutiveGaps = 0;

  for (let i = 0; ; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const dateStr = toDateStr(d);

    if (dateStr < earliest) break;

    const count = byDate.get(dateStr) ?? 0;

    if (count > 0) {
      if (streakEnd === null) streakEnd = dateStr;
      currentStreak++;
      streakStart = dateStr;
      consecutiveGaps = 0;
    } else {
      consecutiveGaps++;
      if (consecutiveGaps > 1) break;
    }
  }

  let longestStreak = 0;
  let longestStart = null;
  let longestEnd = null;
  let runLen = 0;
  let runGap = 0;
  let runStart = null;
  let runEnd = null;

  const [ey, em, ed] = earliest.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const startDate = new Date(ey, em - 1, ed);
  const endDate = new Date(ty, tm - 1, td);

  for (const cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
    const dateStr = toDateStr(cursor);
    const count = byDate.get(dateStr) ?? 0;

    if (count > 0) {
      if (runLen === 0) runStart = dateStr;
      runEnd = dateStr;
      runLen++;
      runGap = 0;
    } else if (runLen > 0) {
      runGap++;
      if (runGap > 1) {
        if (runLen > longestStreak) {
          longestStreak = runLen;
          longestStart = runStart;
          longestEnd = runEnd;
        }
        runLen = 0;
        runGap = 0;
        runStart = null;
        runEnd = null;
      }
    }
  }

  if (runLen > longestStreak) {
    longestStreak = runLen;
    longestStart = runStart;
    longestEnd = runEnd;
  }

  const totalContributions = days.reduce((sum, d) => sum + d.count, 0);

  return { currentStreak, longestStreak, longestStart, longestEnd, totalContributions, streakStart, streakEnd, today, earliest };
};

const renderSVG = ({ currentStreak, longestStreak, longestStart, longestEnd, totalContributions, today, earliest, streakEnd }, themeName, hideBorder) => {
  const t = THEMES[themeName] || THEMES.default;
  const borderOpacity = hideBorder ? "0" : "1";
  const totalRange = `${formatDate(earliest)} – ${formatDate(today)}`;
  const longestRange = longestStart ? `${formatDate(longestStart)} – ${formatDate(longestEnd)}` : "—";
  const streakDay = streakEnd ? formatShortDate(streakEnd) : "—";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="535" height="220" viewBox="0 0 535 220">
  <style>
    text { font-family: 'Segoe UI', Ubuntu, sans-serif; }
    .label { font-size: 14px; fill: ${t.label}; }
    .value { font-size: 26px; font-weight: 700; fill: ${t.value}; }
    .sub   { font-size: 12px; fill: ${t.accent}; }
  </style>

  <rect x="0.5" y="0.5" width="534" height="219" rx="4.5"
    fill="${t.bg}" stroke="${t.border}" stroke-opacity="${borderOpacity}" />

  <line x1="185" y1="28" x2="185" y2="195" stroke="${t.border}" stroke-opacity="0.5" />
  <line x1="350" y1="28" x2="350" y2="195" stroke="${t.border}" stroke-opacity="0.5" />

  <g transform="translate(102.5,0)">
    <text x="0" y="68"  text-anchor="middle" font-size="16" font-weight="600" fill="${t.circleAccent}">Total Contributions</text>
    <text x="0" y="106" text-anchor="middle" class="value">${totalContributions}</text>
    <text x="0" y="128" text-anchor="middle" class="sub">${totalRange}</text>
  </g>

  <g transform="translate(267.5,0)">
    <text x="0" y="54" text-anchor="middle" font-size="22">🔥</text>
    <circle cx="0" cy="108" r="42" fill="${t.circleAccent}" fill-opacity="0.08" stroke="${t.circleAccent}" stroke-width="2.5" />
    <text x="0" y="118" text-anchor="middle" class="value">${currentStreak}</text>
    <text x="0" y="178" text-anchor="middle" font-size="16" font-weight="600" fill="${t.circleAccent}">Current Streak</text>
    <text x="0" y="196" text-anchor="middle" class="sub">${streakDay}</text>
  </g>

  <g transform="translate(432.5,0)">
    <text x="0" y="68"  text-anchor="middle" font-size="16" font-weight="600" fill="${t.circleAccent}">Longest Streak</text>
    <text x="0" y="106" text-anchor="middle" class="value">${longestStreak}</text>
    <text x="0" y="126" text-anchor="middle" class="sub">${longestRange}</text>
  </g>
</svg>`;
};

const handler = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const user = url.searchParams.get("user");
  const theme = url.searchParams.get("theme") || "default";
  const hideBorder = url.searchParams.get("hide_border") === "true";

  if (!user) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing ?user= parameter");
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("GITHUB_TOKEN environment variable is not set");
    return;
  }

  try {
    const contributions = await fetchContributions(user, token);
    const stats = calculateStreak(contributions);
    const svg = renderSVG(stats, theme, hideBorder);

    res.writeHead(200, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    });
    res.end(svg);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`Error: ${err.message}`);
  }
};

export default handler;
