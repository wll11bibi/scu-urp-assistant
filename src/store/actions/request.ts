import cheerio from 'cheerio'
import { API_PATH_V2, getChineseNumber, sleep, logger } from '@/utils'
import {
  AllTermScoresDTO,
  CourseScoreInfo,
  CurrentSemesterStudentAcademicInfo,
  TrainingSchemeYearInfo,
  InstructionalTeachingPlanDTO,
  TrainingSchemeDTO,
  TrainingSchemeNodeDTO,
  TrainingSchemeCourseInfo,
  CourseScheduleInfoDTO,
  CourseScheduleInfo,
  AjaxStudentScheduleDTO,
  CourseInfoList,
  ScuUietpDTO,
  TrainingSchemeBaseInfo,
  BachelorDegreeInfo,
  TrainingScheme
} from '../types'
import { pipe, map } from 'ramda'
import state from '../state'
import { Result } from './result.interface'

function getPageHTML(url: string): Promise<string> {
  return ($.get({
    url,
    beforeSend: xhr =>
      xhr.setRequestHeader('X-Requested-With', {
        toString() {
          return ''
        }
      } as string)
  }) as unknown) as Promise<string>
}

async function LoadHTMLToDealWithError(
  url: string
): Promise<{ title: string; message: string; html: string }> {
  const html = await getPageHTML(url)
  const $ = cheerio.load(html)
  const title = $('title').text()
  const message = $('.main-content .page-content')
    .text()
    .replace(/×/g, '')
    .trim()
  return { title, message, html }
}

async function requestStudentSemesterNumberList(): Promise<string[]> {
  const url = '/student/courseSelect/calendarSemesterCurriculum/index'
  const rawHTML = await getPageHTML(url)
  const codeList = Array.from($('#planCode', rawHTML).find('option')).map(
    v => $(v).val() as string
  )
  return codeList
}

async function requestCourseInfoListBySemester(
  semesterCode: string
): Promise<CourseInfoList[]> {
  const {
    xkxx: [rawCourseInfoList]
  } = (await $.post(
    '/student/courseSelect/thisSemesterCurriculum/ajaxStudentSchedule/past/callback',
    { planCode: semesterCode }
  )) as AjaxStudentScheduleDTO
  const courseInfoList = Object.values(rawCourseInfoList).map(
    ({
      courseCategoryCode,
      courseCategoryName,
      courseName,
      coursePropertiesCode,
      coursePropertiesName,
      dgFlag,
      examTypeCode,
      examTypeName,
      id: {
        coureNumber: courseNumber,
        coureSequenceNumber: courseSequenceNumber,
        executiveEducationPlanNumber
      },
      restrictedCondition,
      timeAndPlaceList
    }) =>
      ({
        courseCategoryCode,
        courseCategoryName,
        courseName,
        coursePropertiesCode,
        coursePropertiesName,
        courseTeacherList: dgFlag
          .split('|')
          .map(s => s.split(','))
          .map(v => ({
            teacherNumber: v[0],
            teacherName: v[1].replace(/[（\(].+[）\)]/, '')
          })),
        examTypeCode,
        examTypeName,
        courseNumber,
        courseSequenceNumber,
        executiveEducationPlanNumber,
        restrictedCondition,
        timeAndPlaceList: timeAndPlaceList
          ? timeAndPlaceList.map(
              ({
                campusName,
                classDay,
                classSessions,
                classWeek,
                classroomName,
                continuingSession,
                teachingBuildingName,
                weekDescription
              }) => ({
                campusName,
                classDay,
                classSessions,
                classWeek,
                classroomName,
                continuingSession,
                teachingBuildingName,
                weekDescription
              })
            )
          : []
      } as CourseInfoList)
  )
  return courseInfoList
}

async function requestStudentInfo(): Promise<Map<string, string>> {
  const url = '/student/rollManagement/rollInfo/index'
  const rawHTML = await getPageHTML(url)
  const programPlanNumber = $('#zx', rawHTML).val() as string
  const programPlanName = $('#zx', rawHTML)
    .parent()
    .text()
    .trim()
  const infos = Array.from($('.profile-info-row', rawHTML))
    .map((v): HTMLElement[][] => {
      const num = $(v).children('.profile-info-name').length
      if (num === 1) {
        return [
          [
            $(v).children('.profile-info-name')[0] as HTMLElement,
            $(v).children('.profile-info-value')[0] as HTMLElement
          ]
        ]
      } else if (num === 2) {
        return [
          [
            $(v).children('.profile-info-name')[0] as HTMLElement,
            $(v).children('.profile-info-value')[0] as HTMLElement
          ],
          [
            $(v).children('.profile-info-name')[1] as HTMLElement,
            $(v).children('.profile-info-value')[1] as HTMLElement
          ]
        ]
      }
      return [[]]
    })
    .flat(1)
    .filter(v => v.length)
    .map(v =>
      v.map(element =>
        $(element)
          .text()
          .trim()
      )
    )
    .filter(v => v[0])
    .concat([
      ['培养方案名称', programPlanName],
      ['培养方案代码', programPlanNumber]
    ])
  return new Map(infos as [string, string][])
}

// 根据测试，教务处的课程信息查询时间间隔为5秒，否则会报频繁查询
const QUERY_TIME_INTERVAL = 5000
let robustnessAdditionalInterval = 1000
let lastTimeScheduleQuery: number = new Date().getTime()
let currentcourseNameScheduleQuery = ''
let currentcourseNumberScheduleQuery = ''
async function requestCourseSchedule(
  semester: string,
  courseName: string,
  courseNumber: string
): Promise<{
  response: string
  sequence?: CourseScheduleInfo[]
}> {
  currentcourseNameScheduleQuery = courseName
  currentcourseNumberScheduleQuery = courseNumber
  const delta = new Date().getTime() - lastTimeScheduleQuery
  if (delta < QUERY_TIME_INTERVAL) {
    await sleep(QUERY_TIME_INTERVAL - delta + robustnessAdditionalInterval)
  }
  if (
    currentcourseNameScheduleQuery === courseName &&
    currentcourseNumberScheduleQuery === courseNumber
  ) {
    lastTimeScheduleQuery = new Date().getTime()
    const res: CourseScheduleInfoDTO = await $.post(
      // 对，你没看错，这里教务处系统打错字了，把Schedule打成了Schdule
      '/student/integratedQuery/course/courseSchdule/courseInfo',
      {
        zxjxjhh: semester,
        kch: courseNumber,
        kcm: courseName,
        pageNum: 1,
        pageSize: 1000
      }
    )
    if (!res.list) {
      robustnessAdditionalInterval *= 2
      return {
        response: 'network_error'
      }
    }
    return {
      response: '',
      sequence: res.list.records
        .map(
          ({
            kcm,
            kch,
            kxh,
            kkxsh,
            kkxsjc,
            xf,
            kclbdm,
            kclbmc,
            kslxdm,
            kslxmc,
            skjs,
            zcsm,
            skxq,
            skjc,
            xqm,
            jxlm,
            jasm,
            bkskrl,
            bkskyl,
            xkxzsm
          }) => ({
            courseName: kcm || '',
            courseNumber: kch || '',
            courseSequenceNumber: kxh || '',
            courseDeptNumber: kkxsh || '',
            courseDeptName: kkxsjc || '',
            credit: xf || 0,
            courseCategoryCode: kclbdm || '',
            courseCategoryName: kclbmc || '',
            examTypeCode: kslxdm || '',
            examTypeName: kslxmc || '',
            courseTeacher: skjs || '',
            courseTime: `${zcsm}星期${getChineseNumber(skxq)}${skjc}节`,
            campusName: `${xqm}校区${jxlm}${jasm}`,
            classCapacityRemaining: `${bkskyl} / ${bkskrl}`,
            courseRegNote: xkxzsm && xkxzsm !== ';' ? xkxzsm : ''
          })
        )
        .reduce((acc, cur) => {
          let index = -1
          for (let i = 0; i < acc.length; i++) {
            if (acc[i].courseSequenceNumber === cur.courseSequenceNumber) {
              index = i
              break
            }
          }
          const merge = (
            obj1: CourseScheduleInfo,
            obj2: CourseScheduleInfo
          ): CourseScheduleInfo => {
            const result = {} as CourseScheduleInfo
            for (const key in obj1) {
              result[key] =
                obj1[key] === obj2[key]
                  ? obj1[key]
                  : `${obj1[key]}，${obj2[key]}`
            }
            return result
          }
          if (index === -1) {
            return acc.concat(cur)
          }
          acc[index] = merge(acc[index], cur)
          return acc
        }, [] as CourseScheduleInfo[])
        .sort(
          (a, b) =>
            Number(a.courseSequenceNumber) - Number(b.courseSequenceNumber)
        )
    }
  }
  return {
    response: 'no_render'
  }
}

function requestTrainingScheme(
  num: number
): Promise<{
  info: TrainingSchemeBaseInfo
  list: TrainingSchemeYearInfo[]
}> {
  const coursePropertyNameList = ['必修', '选修']
  const res = Promise.all([
    $.get(`/student/rollManagement/project/${num}/2/detail`).then(
      ({ jhFajhb, treeList }: InstructionalTeachingPlanDTO) => ({
        info: jhFajhb,
        list: treeList
          .reduce((acc, cur) => {
            if (cur.name.match(/^\d{4}-\d{4}学年$/)) {
              acc.push({
                name: cur.name,
                children: []
              })
            } else if (cur.name === '春' || cur.name === '秋') {
              acc[acc.length - 1].children.push({
                name: cur.name,
                children: []
              })
            } else {
              const r = cur.urlPath.match(/project\/.+\/(\d+)$/)
              acc[acc.length - 1].children[
                acc[acc.length - 1].children.length - 1
              ].children.push({
                courseName: cur.name,
                courseNumber: r ? r[1] : '',
                courseAttributes: [],
                courseMajor: '',
                coursePropertyName: ''
              })
            }
            return acc
          }, [] as TrainingSchemeYearInfo[])
          .sort((a, b) => {
            const regexpResultA = a.name.match(/^(\d+)-(\d+)学年$/)
            const regexpResultB = b.name.match(/^(\d+)-(\d+)学年$/)
            if (!regexpResultA || !regexpResultB) {
              return 0
            }
            const resultA = Number(regexpResultA[1]) + Number(regexpResultA[2])
            const resultB = Number(regexpResultB[1]) + Number(regexpResultB[2])
            return resultA - resultB
          })
      })
    ),
    $.get(`/student/rollManagement/project/${num}/1/detail`).then(
      ({ treeList }: TrainingSchemeDTO) =>
        Object.values(
          treeList.reduce(
            (acc, cur) => {
              acc[cur.id] = cur
              if (!acc[cur.pId]) {
                acc[cur.pId] = {
                  id: cur.pId,
                  courseName: '',
                  coursePropertyName: '',
                  isDir: false,
                  name: '',
                  pId: '',
                  urlPath: ''
                }
              }
              cur.parent = acc[cur.pId]
              cur.isDir = cur.name.includes('fa-kz')
              if (cur.name.includes('必修')) {
                cur.coursePropertyName = '必修'
              } else if (cur.name.includes('选修')) {
                cur.coursePropertyName = '选修'
              } else {
                cur.coursePropertyName = ''
              }
              const r = cur.name.match(/<\/i>(.+)$/)
              cur.courseName = r
                ? r[1].replace(' 必修', '').replace(' 选修', '')
                : ''
              return acc
            },
            {} as {
              [key: string]: TrainingSchemeNodeDTO
            }
          )
        ).reduce(
          (acc, { urlPath, isDir, parent, courseName, coursePropertyName }) => {
            if (urlPath) {
              const r = urlPath.match(/@(.+)$/)
              const courseNumber = r ? r[1] : ''
              if (!isDir) {
                const courseAttributes = []
                let p = parent
                while (p && p.courseName) {
                  if (!coursePropertyNameList.includes(p.courseName)) {
                    courseAttributes.unshift(p.courseName)
                  }
                  p = p.parent
                }
                acc[courseNumber] = {
                  courseName,
                  courseNumber,
                  coursePropertyName,
                  courseAttributes,
                  courseMajor: ''
                }
              }
            }
            return acc
          },
          {} as {
            [key: string]: TrainingSchemeCourseInfo
          }
        )
    )
  ]).then(([{ info, list }, table]) => ({
    info,
    list: list.map(year => ({
      name: year.name,
      children: year.children.map(semester => ({
        name: semester.name,
        children: semester.children
          .map(v =>
            Object.assign(v, table[v.courseNumber], {
              courseMajor: `${info.zym}（${info.njmc}）`
            })
          )
          .sort((a, b) => {
            const propertyWeight = {
              必修: 100,
              '中华文化（春）': 75,
              '中华文化（秋）': 75,
              选修: 50
            } as {
              [key: string]: number
            }
            const attributeWeight = {
              公共基础课: 10,
              公共课: 10,
              '中华文化（春）_kz': 9,
              '中华文化（秋）_kz': 9,
              学科基础课: 8,
              专业基础课: 8,
              专业课: 6,
              实践环节: 4
            } as {
              [key: string]: number
            }
            const getAttributesWeight = (attributes: string[]): number =>
              attributes.reduce(
                (acc, cur) => acc + (attributeWeight[cur] || 0),
                0
              )
            const weightA =
              (propertyWeight[a.coursePropertyName] || 0) +
              getAttributesWeight(a.courseAttributes)
            const weightB =
              (propertyWeight[b.coursePropertyName] || 0) +
              getAttributesWeight(b.courseAttributes)
            return weightB - weightA
          })
      }))
    })) as TrainingSchemeYearInfo[]
  }))
  return res
}

let trainingSchemeList: TrainingScheme[]

async function requestTrainingSchemeList(): Promise<TrainingScheme[]> {
  const url = `${API_PATH_V2}/student/training_scheme`
  try {
    if (!trainingSchemeList) {
      trainingSchemeList = await $.ajax({
        method: 'GET',
        url,
        headers: {
          Authorization: `Bearer ${state.user.accessToken}`
        }
      })
    }
    return trainingSchemeList
  } catch (error) {
    const {
      status,
      statusText,
      responseJSON: { message }
    } = error
    throw new Error(`[${status}] ${statusText}: ${message}`)
  }
}

async function requestBachelorDegree(
  queryStr: string
): Promise<BachelorDegreeInfo[]> {
  const url = `${API_PATH_V2}/info/bachelor_degree/${encodeURIComponent(
    queryStr
  )}`
  try {
    return await $.ajax({
      method: 'GET',
      url,
      headers: {
        Authorization: `Bearer ${state.user.accessToken}`
      }
    })
  } catch (error) {
    const {
      status,
      statusText,
      responseJSON: { message }
    } = error
    throw new Error(`[${status}] ${statusText}: ${message}`)
  }
}

async function requestScuUietpList(queryStr: string): Promise<ScuUietpDTO> {
  const url = `${API_PATH_V2}/info/scu_uietp/${encodeURIComponent(queryStr)}`
  try {
    const res = await $.ajax({
      method: 'GET',
      url,
      headers: {
        Authorization: `Bearer ${state.user.accessToken}`
      }
    })
    return res as ScuUietpDTO
  } catch (error) {
    const {
      status,
      statusText,
      responseJSON: { message }
    } = error
    throw new Error(`[${status}] ${statusText}: ${message}`)
  }
}

async function requestCurrentSemesterStudentAcademicInfo(): Promise<
  CurrentSemesterStudentAcademicInfo
> {
  // 加载本学期基本信息
  const [
    {
      zxjxjhh: currentSemester,
      gpa,
      courseNum: courseNumber,
      courseNum_bxqyxd: currentSemesterCourseNumber,
      coursePas: failedCourseNumber
    }
  ] = JSON.parse(await $.post('/main/academicInfo'))
  return {
    courseNumber,
    currentSemester,
    gpa,
    currentSemesterCourseNumber,
    failedCourseNumber
  }
}

function convertSemesterNumberToText(number: string): string {
  const r = number.match(/(\d+)-(\d+)-(.+)/)
  if (r) {
    const begin = r[1]
    const end = r[2]
    const season = r[3] === '1-1' ? '秋' : '春'
    return `${begin}-${end}学年 ${season}季学期`
  }
  return number
}

/**
 * 根据分数返回对应的绩点
 *
 * @param {number} score 分数
 * @param {string} semester 学期
 * @returns 绩点
 */
function getPointByScore(
  score: number | undefined,
  semester: string
): number | undefined {
  if (!score) {
    return undefined
  }
  // 2017年起，川大修改了绩点政策，因此要检测学期的年份
  const r = semester.match(/^\d+/)
  if (!r) {
    return 0
  }
  const enrollmentYear = Number(r[0])
  if (enrollmentYear >= 2017) {
    // 2017-2018秋季学期起使用如下标准（Fall Term 2017-2018~Present）
    if (score >= 90) {
      return 4
    } else if (score >= 85) {
      return 3.7
    } else if (score >= 80) {
      return 3.3
    } else if (score >= 76) {
      return 3
    } else if (score >= 73) {
      return 2.7
    } else if (score >= 70) {
      return 2.3
    } else if (score >= 66) {
      return 2
    } else if (score >= 63) {
      return 1.7
    } else if (score >= 61) {
      return 1.3
    } else if (score >= 60) {
      return 1
    } else {
      return 0
    }
  } else {
    // 2017-2018秋季学期以前使用如下标准（Before Fall Term 2017-2018）
    if (score >= 95) {
      return 4
    } else if (score >= 90) {
      return 3.8
    } else if (score >= 85) {
      return 3.6
    } else if (score >= 80) {
      return 3.2
    } else if (score >= 75) {
      return 2.7
    } else if (score >= 70) {
      return 2.2
    } else if (score >= 65) {
      return 1.7
    } else if (score >= 60) {
      return 1
    } else {
      return 0
    }
  }
}

function filterCourseScoreInfoList(list: CourseScoreInfo[]): CourseScoreInfo[] {
  return (
    list
      // 根据 http://jwc.scu.edu.cn/detail/122/6891.htm 《网上登录成绩的通知》 的说明
      // 教师「暂存」的成绩学生不应看到
      // 因此为了和教务处成绩显示保持一致，这里只显示「已提交」的成绩
      // TODO: 考虑做开关，让用户决定看不看
      .filter(v => v.inputStatusCode === '05')
      // 分数可能为null，必须分数不为null才显示
      .filter(v => v.courseScore)
  )
}

async function requestAllTermsCourseScoreInfoList(): Promise<
  CourseScoreInfo[]
> {
  const url = '/student/integratedQuery/scoreQuery/allTermScores/data'
  try {
    const {
      list: {
        pageContext: { totalCount }
      }
    } = (await $.post(url, {
      zxjxjhh: '',
      kch: '',
      kcm: '',
      pageNum: 1,
      pageSize: 1
    })) as AllTermScoresDTO

    const {
      list: { records }
    } = (await $.post(
      '/student/integratedQuery/scoreQuery/allTermScores/data',
      {
        zxjxjhh: '',
        kch: '',
        kcm: '',
        pageNum: 1,
        pageSize: totalCount
      }
    )) as AllTermScoresDTO

    type recordType = typeof records[0]
    const formatRecord = ([
      executiveEducationPlanNumber,
      courseNumber,
      courseSequenceNumber,
      examTime,
      inputStatusCode,
      coursePropertyCode,
      examTypeCode,
      inputMethodCode,
      courseScore,
      levelCode,
      // 缓考是 '00'
      unpassedReasonCode,
      courseName,
      englishCourseName,
      credit,
      studyHour,
      coursePropertyName,
      examTypeName,
      levelName,
      // 缓考是 '申请缓考'
      unpassedReasonExplain
    ]: recordType): CourseScoreInfo => ({
      executiveEducationPlanNumber,
      executiveEducationPlanName: convertSemesterNumberToText(
        executiveEducationPlanNumber
      ),
      courseNumber,
      courseSequenceNumber,
      examTime,
      inputStatusCode,
      coursePropertyCode,
      examTypeCode,
      inputMethodCode,
      courseScore,
      levelCode,
      unpassedReasonCode,
      courseName,
      englishCourseName,
      credit,
      studyHour,
      coursePropertyName,
      examTypeName,
      levelName,
      unpassedReasonExplain,
      gradePoint: getPointByScore(courseScore, executiveEducationPlanNumber)
    })

    return pipe(map(formatRecord), filterCourseScoreInfoList)(records)
  } catch (error) {
    const { title, message, html } = await LoadHTMLToDealWithError(url)
    logger.error({ title, message, html })
    throw new Error(`${title}: ${message}`)
  }
}

async function requestThisTermCourseScoreInfoList(): Promise<
  CourseScoreInfo[]
> {
  const url = '/student/integratedQuery/scoreQuery/thisTermScores/data'
  try {
    const data = await $.get(url)
    const [{ list }]: [{ list: any[] }] = data
    // console.log(`state: ${state}`)
    const res = filterCourseScoreInfoList(
      list.map(
        v =>
          ({
            courseName: v.courseName || '',
            englishCourseName: v.englishCourseName || '',
            courseNumber: v.id.courseNumber || '',
            // 对，你没看错，这个地方教务处接口是错别字，把course打成了coure
            courseSequenceNumber: v.coureSequenceNumber || '',
            credit: Number(v.credit) || 0,
            coursePropertyCode: v.coursePropertyCode || '',
            coursePropertyName: v.coursePropertyName || '',
            maxScore: Number(v.maxcj) || 0,
            avgScore: Number(v.avgcj) || 0,
            minScore: Number(v.mincj) || 0,
            courseScore: Number(v.courseScore) || 0,
            // 对，你没看错，这个地方教务处接口是错别字，把level打成了levle
            levelCode: v.levlePoint || '',
            levelName: v.levelName || '',
            gradePoint: Number(v.gradePoint) || 0,
            rank: Number(v.rank) || 0,
            examTime: v.id.examtime || '',
            unpassedReasonCode: v.unpassedReasonCode || '',
            unpassedReasonExplain: v.unpassedReasonExplain || '',
            executiveEducationPlanNumber:
              v.id.executiveEducationPlanNumber || '',
            executiveEducationPlanName:
              convertSemesterNumberToText(v.id.executiveEducationPlanNumber) ||
              '',
            inputStatusCode: v.inputStatusCode || '',
            inputMethodCode: v.inputMethodCode || '',
            studyHour: Number(v.studyHour) || 0,
            examTypeName: v.examTypeName || ''
          } as CourseScoreInfo)
      )
    )
    return res
  } catch (error) {
    const { title, message, html } = await LoadHTMLToDealWithError(url)
    logger.error({ title, message, html })
    throw new Error(`${title}: ${message}`)
  }
}

type LoginResultData = {
  accessToken: string
}

export async function login(): Promise<LoginResultData> {
  try {
    const { version, clientType: type } = state.core
    const { id } = state.user
    const url = `${API_PATH_V2}/user/login`
    const res: Result = await $.post(url, {
      id,
      client: { version, type }
    })
    if (res.error) {
      const { code, title, message } = res.error
      throw new Error(`[${code}] ${title}: ${message}`)
    }
    const { accessToken } = res.data as LoginResultData
    return { accessToken }
  } catch (error) {
    const {
      status,
      statusText,
      responseJSON: { message }
    } = error
    throw new Error(`[${status}] ${statusText}: ${message}`)
  }
}

export {
  requestThisTermCourseScoreInfoList,
  requestAllTermsCourseScoreInfoList,
  requestCurrentSemesterStudentAcademicInfo,
  requestTrainingSchemeList,
  requestTrainingScheme,
  requestCourseSchedule,
  requestCourseInfoListBySemester,
  requestStudentSemesterNumberList,
  requestStudentInfo,
  requestScuUietpList,
  requestBachelorDegree
}
