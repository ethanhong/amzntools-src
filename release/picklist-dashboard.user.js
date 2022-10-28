// ==UserScript==
// @name         Picklist Dashboard
// @namespace    https://github.com/ethanhong/amzn-tools/tree/main/release
// @version      1.4.4
// @description  Picklist dashboard
// @author       Pei
// @match        https://aftlite-na.amazon.com/picklist_group
// @match        https://aftlite-na.amazon.com/picklist_group/index
// @match        https://aftlite-na.amazon.com/picklist_group?selected_tab*
// @match        https://aftlite-na.amazon.com/picklist_group/index?selected_tab*
// @match        https://aftlite-portal.amazon.com/picklist_group*
// @updateURL    https://ethanhong.github.io/amzn-tools/release/picklist-dashboard.user.js
// @downloadURL  https://ethanhong.github.io/amzn-tools/release/picklist-dashboard.user.js
// @supportURL   https://github.com/ethanhong/amzn-tools/issues
// @require      https://unpkg.com/react@18/umd/react.production.min.js
// @require      https://unpkg.com/react-dom@18/umd/react-dom.production.min.js
// @require      https://www.kryogenix.org/code/browser/sorttable/sorttable.js
// @grant        GM_addStyle
// ==/UserScript==

/* global React */
/* global ReactDOM */

const e = React.createElement

showDashboard()

// eslint-disable-next-line no-unused-vars
async function showDashboard() {
  const isAftlitePortal = window.location.hostname === 'aftlite-portal.amazon.com'
  const isCompletePage = window.location.search.toLowerCase().includes('completed')
  const oldTbl = document.querySelector(isAftlitePortal ? '#main-content > table' : '#picklist_group_list')
  // mount app
  const rootDiv = document.createElement('div')
  rootDiv.setAttribute('id', 'root')
  oldTbl.before(rootDiv)
  ReactDOM.createRoot(rootDiv).render(e(App, { oldTbl, isAftlitePortal, isCompletePage }))
}

function App({ oldTbl, isAftlitePortal, isCompletePage }) {
  const switchRef = React.useRef()
  const dashboardRef = React.useRef()

  const bags = React.useMemo(
    () => getBags(oldTbl, isAftlitePortal, isCompletePage),
    [oldTbl, isAftlitePortal, isCompletePage]
  )
  const [groups, setGroups] = React.useState(gatherByGroupId(bags))

  React.useEffect(() => {
    const abortController = new AbortController()
    bags.map(async (bag) => {
      const gId = bag.groupId
      const thisGroup = groups.find((group) => group.groupId === gId)

      await getBagCPT(bag.plistId[0], isAftlitePortal, abortController).then((cpt) => setBagCPT(cpt, gId, setGroups))
      if (!thisGroup.isChecked) {
        thisGroup.isChecked = true
        await getGroupData(gId, isAftlitePortal, abortController).then((data) => setGroupInfo(data, gId, setGroups))
      }
    })
    return () => abortController.abort()
  }, [])

  const backSwitch = e('form', { id: 'switch-form' }, [
    e('input', {
      type: 'checkbox',
      ref: switchRef,
      onChange: () => {
        dashboardRef.current.style.display = switchRef.current.checked ? 'none' : 'block'
      },
    }),
    ' Hide dashboard',
  ])
  const dashboard = e('div', { ref: dashboardRef }, e(Dashboard, { groups, isAftlitePortal }))
  return e(React.Fragment, null, [backSwitch, dashboard])
}

async function getBagCPT(plistId, isAftlitePortal, { signal }) {
  const url = isAftlitePortal ? '/picklist/view_picklist?picklist_id=' : '/wms/view_picklist?picklist_id='
  const cptSelector = isAftlitePortal
    ? '#main-content > div:nth-child(4) > div.a-column.a-span4 > h5 > span'
    : 'body > table > tbody > tr:nth-child(4) > td:nth-child(2)'
  try {
    const res = await fetch(`${url}${plistId}`, { signal })
    const txt = await res.text()
    const html = new DOMParser().parseFromString(txt, 'text/html')
    const content = html.querySelector(cptSelector).textContent
    return content.split(/\s/).slice(0, -2).join(' ').replace('am', ' am').replace('pm', ' pm').replace('between ', '')
  } catch (err) {
    console.log(`${err} \n picklistId: ${plistId}`)
    return null
  }
}

function setBagCPT(cpt, groupId, setGroups) {
  setGroups((prev) => {
    const i = prev.findIndex((group) => group.groupId === groupId)
    const currentGroup = prev[i]
    currentGroup.cpt.push(new Date(cpt))
    return [...prev.slice(0, i), currentGroup, ...prev.slice(i + 1)]
  })
}

async function getGroupData(groupId, isAftlitePortal, { signal }) {
  const url = '/picklist_group/display_picklist_group?picklist_group_id='
  const trSelector = isAftlitePortal
    ? '#main-content > table > tbody > tr:not(tr:first-child)'
    : '#picklist_group > tbody > tr'
  try {
    const res = await fetch(`${url}${groupId}`, { signal })
    const txt = await res.text()
    const html = new DOMParser().parseFromString(txt, 'text/html')
    const rows = [...html.querySelectorAll(trSelector)]
    const data = rows.map((row) => [...row.children]).map((row) => row.map((cell) => cell.innerText.trim()))
    return data[0].map((col, i) => data.map((row) => row[i])) // transpose
  } catch (err) {
    console.log(`${err} \n groupId: ${groupId}`)
    return null
  }
}

function setGroupInfo(data, groupId, setGroups) {
  setGroups((prev) => {
    const i = prev.findIndex((group) => group.groupId === groupId)
    const currentGroup = prev[i]
    currentGroup.remainUnit = sum(data[3]) - sum(data[4])
    currentGroup.remainBin = new Set(data[2].filter((_, j) => !data[4][j])).size

    const skippedId = Array.from(new Set(data[1].filter((_, j) => Boolean(data[5][j]) || Boolean(data[6][j]))))
    const skippedCPT = skippedId.map((plistId) => currentGroup.cpt[currentGroup.plistId.indexOf(plistId)])
    currentGroup.skipped = skippedId
      .map((_, j) => ({ plistId: skippedId[j], cpt: skippedCPT[j] }))
      .sort((a, b) => new Date(a.cpt) - new Date(b.cpt))
    return [...prev.slice(0, i), currentGroup, ...prev.slice(i + 1)]
  })
}

function getBags(tbl, isAftlitePortal, isCompletePage) {
  const bags = [
    ...tbl.querySelectorAll(
      isAftlitePortal ? 'tbody > tr:not(tr:first-child)' : 'table#picklist_group_list > tbody > tr'
    ),
  ]
    .map((x) => [...x.querySelectorAll('td')])
    .map((x) => ({
      groupId: x[0].textContent.trim(),
      groupURL: x[0].firstElementChild.href,
      picker: x[1].textContent.trim(),
      pickerURL: x[1].firstElementChild.href,
      status: x[2].textContent,
      completedAt: x[3].textContent || 'In progress',
      plistId: [x[4].firstElementChild.textContent],
      orderId: x[5].firstElementChild.href.match(/\d{7}/)[0],
      zone: x[6].textContent,
      cpt: [],
      skipped: [],
      remainUnit: null,
      remainBin: null,
      isChecked: false,
    }))
  return isCompletePage
    ? bags
        .filter((x) => minDiff(new Date(), new Date(x.completedAt)) < 30)
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    : bags
}

function gatherByGroupId(bags) {
  const groups = []
  for (let i = 0; i < bags.length; i += 1) {
    const sameGroup = groups.find((x) => x.groupId === bags[i].groupId)
    if (!sameGroup) {
      groups.push(JSON.parse(JSON.stringify(bags[i])))
    } else {
      sameGroup.plistId.push(bags[i].plistId[0])
    }
  }
  return groups
}

function Dashboard({ groups, isAftlitePortal }) {
  return e('table', { className: 'sortable', id: 'dashboard' }, [
    e('thead', null, e(Header)),
    e('tbody', null, [
      ...groups.map((group) => e(GroupRow, { group, isAftlitePortal, key: group.groupId })),
      e(TotalRow, { groups }),
    ]),
  ])
}

function Header() {
  const titles = [
    'Picklist Group',
    'Zone',
    'Picker',
    'Remaining Units',
    'Remaining Bins',
    // 'Status',
    'Completed at',
    '< 1 Hour',
    '< 2 Hours',
    '< 3 Hours',
    '> 3 Hours',
    'Skipped',
  ]
  return e(
    'tr',
    null,
    titles.map((x) => e('th', { style: null, key: x }, x))
  )
}

function GroupRow({ group, isAftlitePortal }) {
  const bagURL = isAftlitePortal ? '/picklist/pack_by_picklist?picklist_id=' : '/wms/pack_by_picklist?picklist_id='
  const skipBags = group.skipped.map((bag) =>
    e(
      'div',
      { key: bag.plistId },
      e('a', { className: 'skipped', href: `${bagURL}${bag.plistId}` }, `${bag.cpt.getHours()}:00`)
    )
  )
  const now = new Date()
  const minFromNow = group.cpt.map((t) => minDiff(t, now))

  const cells = [
    e('td', null, e('a', { href: group.groupURL }, group.groupId)),
    e('td', null, group.zone),
    e('td', null, e('a', { href: group.pickerURL }, group.picker)),
    e('td', null, group.remainUnit),
    e('td', null, group.remainBin),
    // e('td', null, group.status),
    e('td', null, group.completedAt),
    e('td', null, minFromNow.filter((x) => x < 60).length),
    e('td', null, minFromNow.filter((x) => x >= 60 && x < 120).length),
    e('td', null, minFromNow.filter((x) => x >= 120 && x < 180).length),
    e('td', null, minFromNow.filter((x) => x >= 180).length),
    e('td', { className: skipBags.length ? 'skipped' : '' }, skipBags),
  ]
  return e('tr', null, cells)
}

function TotalRow({ groups }) {
  const now = new Date()
  const timeDiff = groups.map((x) => x.cpt.map((t) => minDiff(t, now)))
  const cells = Array(11).fill(e('td', null, ''))
  cells[5] = e('td', null, 'Subtotal')
  cells[6] = e('td', null, sum(timeDiff.map((row) => row.filter((x) => x < 60).length)))
  cells[7] = e('td', null, sum(timeDiff.map((row) => row.filter((x) => x >= 60 && x < 120).length)))
  cells[8] = e('td', null, sum(timeDiff.map((row) => row.filter((x) => x >= 120 && x < 180).length)))
  cells[9] = e('td', null, sum(timeDiff.map((row) => row.filter((x) => x >= 180).length)))

  return e('tr', { id: 'total-row' }, cells)
}

function minDiff(dt1, dt2) {
  return Math.floor((dt1 - dt2) / 1000 / 60)
}

function sum(arr) {
  let result = 0
  for (let i = 0; i < arr.length; i += 1) {
    const int = parseInt(arr[i], 10) || 0
    result += int
  }
  return result
}

// eslint-disable-next-line no-undef
GM_addStyle(`
  #root {
    margin: 0 !important;
    margin-bottom: 1rem !important;
    padding: 0 !important;
    box-sizing: border-box !important;
  }

  #dashboard th, #dashboard td {
    border-collapse: collapse;
    border: 1px solid #e8e8e8;
    text-align: center;
    vertical-align: middle;
  }

  #dashboard th {
    background-color: #f0f0f0;
    padding: 0.5rem;
  }

  #dashboard td {
    padding: 0.5rem;
  }

  #dashboard tr:hover {
    background-color: #f8f8f8;
  }

  #dashboard td.skipped {
    background-color: pink;
  }

  #dashboard a.skipped {
    background-color: pink;
    color: red;
  }

  tr#total-row {
    font-weight: bold;
  }

  /* Sortable tables */
  table.sortable thead {
    font-weight: bold;
    cursor: default;
  }
`)
