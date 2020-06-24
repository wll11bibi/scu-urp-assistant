import Vue from 'vue'
import { getPluginIcon } from '@/helper/getter'
import { SUAPlugin } from '@/core/types'
import * as template from './template'
import { Logger } from '@/helper/logger'

export default {
  name: 'textbook-selection',
  displayName: '教材选择',
  icon: getPluginIcon('textbook-selection'),
  isNecessary: false,
  brief:
    '选定教材时一个一个选择不太方便？该插件可以帮助您快捷地一键全选所有教材或者全不选所有教材。',
  pathname: '/student/courseSelect/books/dealBooks/index',
  style: require('./index.scss').toString(),
  init() {
    $('#pane_jclx').prepend(template.actionBar())
    const $selectAllBtn = $('#textbook-selection-select-all-btn')
    const $unselectAllBtn = $('#textbook-selection-unselect-all-btn')
    const url = '/student/courseSelect/books/dealBooks/saveJc'
    $selectAllBtn.click(async () => {
      const tokenValue = $('#tokenValue').val()
      const param = Array.from($('#jclx_table input'))
        .map(v => `${v.getAttribute('value')},1`)
        .join('|')
      const { result, token } = await $.post(url, { tokenValue, param })
      Logger.info({ result, token })
      if (result === 'ok') {
        Vue.prototype.$message({
          message: '全选所有教材成功！正在刷新页面……',
          type: 'success'
        })
        setTimeout(() => {
          window.location.reload()
        }, 3000)
      }
    })
    $unselectAllBtn.click(async () => {
      const tokenValue = $('#tokenValue').val()
      const param = Array.from($('#jclx_table input'))
        .map(v => `${v.getAttribute('value')},0`)
        .join('|')
      const { result, token } = await $.post(url, { tokenValue, param })
      Logger.info({ result, token })
      if (result === 'ok') {
        Vue.prototype.$message({
          message: '全不选所有教材成功！正在刷新页面……',
          type: 'success'
        })
        setTimeout(() => {
          window.location.reload()
        }, 3000)
      }
    })
  }
} as SUAPlugin
