
function ngDirective(directive) {
	if (isFunction(directive)) {
		directive = {
			link: directive
		};
	}
	directive.restrict = directive.restrict || 'AC';
	return valueFn(directive);
}

var htmlAnchorDirective = valueFn({
	restrict: 'E',
	compile: function(element, attr) {
		if (!attr.href && !attr.xlinkHref) {
			return function(scope, element) {
				// If the linked element is not an anchor tag anymore, do nothing
				if (element[0].nodeName.toLowerCase() !== 'a') return;

				// SVGAElement does not use the href attribute, but rather the 'xlinkHref' attribute.
				var href = toString.call(element.prop('href')) === '[object SVGAnimatedString]' ?
									 'xlink:href' : 'href';
				element.on('click', function(event) {
					// if we have no href url, then don't navigate anywhere.
					if (!element.attr(href)) {
						event.preventDefault();
					}
				});
			};
		}
	}
});

var ngAttributeAliasDirectives = {};

// boolean attrs are evaluated
forEach(BOOLEAN_ATTR, function(propName, attrName) {
	// binding to multiple is not supported
	if (propName == "multiple") return;

	function defaultLinkFn(scope, element, attr) {
		scope.$watch(attr[normalized], function ngBooleanAttrWatchAction(value) {
			attr.$set(attrName, !!value);
		});
	}

	var normalized = directiveNormalize('ng-' + attrName);
	var linkFn = defaultLinkFn;

	if (propName === 'checked') {
		linkFn = function(scope, element, attr) {
			// ensuring ngChecked doesn't interfere with ngModel when both are set on the same input
			if (attr.ngModel !== attr[normalized]) {
				defaultLinkFn(scope, element, attr);
			}
		};
	}

	ngAttributeAliasDirectives[normalized] = function() {
		return {
			restrict: 'A',
			priority: 100,
			link: linkFn
		};
	};
});

// aliased input attrs are evaluated
forEach(ALIASED_ATTR, function(htmlAttr, ngAttr) {
	ngAttributeAliasDirectives[ngAttr] = function() {
		return {
			priority: 100,
			link: function(scope, element, attr) {
				//special case ngPattern when a literal regular expression value
				//is used as the expression (this way we don't have to watch anything).
				if (ngAttr === "ngPattern" && attr.ngPattern.charAt(0) == "/") {
					var match = attr.ngPattern.match(REGEX_STRING_REGEXP);
					if (match) {
						attr.$set("ngPattern", new RegExp(match[1], match[2]));
						return;
					}
				}

				scope.$watch(attr[ngAttr], function ngAttrAliasWatchAction(value) {
					attr.$set(ngAttr, value);
				});
			}
		};
	};
});

// ng-src, ng-srcset, ng-href are interpolated
forEach(['src', 'srcset', 'href'], function(attrName) {
	var normalized = directiveNormalize('ng-' + attrName);
	ngAttributeAliasDirectives[normalized] = function() {
		return {
			priority: 99, // it needs to run after the attributes are interpolated
			link: function(scope, element, attr) {
				var propName = attrName,
						name = attrName;

				if (attrName === 'href' &&
						toString.call(element.prop('href')) === '[object SVGAnimatedString]') {
					name = 'xlinkHref';
					attr.$attr[name] = 'xlink:href';
					propName = null;
				}

				attr.$observe(normalized, function(value) {
					if (!value) {
						if (attrName === 'href') {
							attr.$set(name, null);
						}
						return;
					}

					attr.$set(name, value);

					// on IE, if "ng:src" directive declaration is used and "src" attribute doesn't exist
					// then calling element.setAttribute('src', 'foo') doesn't do anything, so we need
					// to set the property as well to achieve the desired effect.
					// we use attr[attrName] value since $set can sanitize the url.
					if (msie && propName) element.prop(propName, attr[name]);
				});
			}
		};
	};
});

var nullFormCtrl = {
	$addControl: noop,
	$$renameControl: nullFormRenameControl,
	$removeControl: noop,
	$setValidity: noop,
	$setDirty: noop,
	$setPristine: noop,
	$setSubmitted: noop
},
SUBMITTED_CLASS = 'ng-submitted';

function nullFormRenameControl(control, name) {
	control.$name = name;
}

//asks for $scope to fool the BC controller module
FormController.$inject = ['$element', '$attrs', '$scope', '$animate', '$interpolate'];
function FormController(element, attrs, $scope, $animate, $interpolate) {
	var form = this,
			controls = [];

	// init state
	form.$error = {};
	form.$$success = {};
	form.$pending = undefined;
	form.$name = $interpolate(attrs.name || attrs.ngForm || '')($scope);
	form.$dirty = false;
	form.$pristine = true;
	form.$valid = true;
	form.$invalid = false;
	form.$submitted = false;
	form.$$parentForm = nullFormCtrl;

	form.$rollbackViewValue = function() {
		forEach(controls, function(control) {
			control.$rollbackViewValue();
		});
	};

	form.$commitViewValue = function() {
		forEach(controls, function(control) {
			control.$commitViewValue();
		});
	};

	form.$addControl = function(control) {
		// Breaking change - before, inputs whose name was "hasOwnProperty" were quietly ignored
		// and not added to the scope.  Now we throw an error.
		assertNotHasOwnProperty(control.$name, 'input');
		controls.push(control);

		if (control.$name) {
			form[control.$name] = control;
		}

		control.$$parentForm = form;
	};

	// Private API: rename a form control
	form.$$renameControl = function(control, newName) {
		var oldName = control.$name;

		if (form[oldName] === control) {
			delete form[oldName];
		}
		form[newName] = control;
		control.$name = newName;
	};

	form.$removeControl = function(control) {
		if (control.$name && form[control.$name] === control) {
			delete form[control.$name];
		}
		forEach(form.$pending, function(value, name) {
			form.$setValidity(name, null, control);
		});
		forEach(form.$error, function(value, name) {
			form.$setValidity(name, null, control);
		});
		forEach(form.$$success, function(value, name) {
			form.$setValidity(name, null, control);
		});

		arrayRemove(controls, control);
		control.$$parentForm = nullFormCtrl;
	};

	addSetValidityMethod({
		ctrl: this,
		$element: element,
		set: function(object, property, controller) {
			var list = object[property];
			if (!list) {
				object[property] = [controller];
			} else {
				var index = list.indexOf(controller);
				if (index === -1) {
					list.push(controller);
				}
			}
		},
		unset: function(object, property, controller) {
			var list = object[property];
			if (!list) {
				return;
			}
			arrayRemove(list, controller);
			if (list.length === 0) {
				delete object[property];
			}
		},
		$animate: $animate
	});

	form.$setDirty = function() {
		$animate.removeClass(element, PRISTINE_CLASS);
		$animate.addClass(element, DIRTY_CLASS);
		form.$dirty = true;
		form.$pristine = false;
		form.$$parentForm.$setDirty();
	};

	form.$setPristine = function() {
		$animate.setClass(element, PRISTINE_CLASS, DIRTY_CLASS + ' ' + SUBMITTED_CLASS);
		form.$dirty = false;
		form.$pristine = true;
		form.$submitted = false;
		forEach(controls, function(control) {
			control.$setPristine();
		});
	};

	form.$setUntouched = function() {
		forEach(controls, function(control) {
			control.$setUntouched();
		});
	};

	form.$setSubmitted = function() {
		$animate.addClass(element, SUBMITTED_CLASS);
		form.$submitted = true;
		form.$$parentForm.$setSubmitted();
	};
}

var formDirectiveFactory = function(isNgForm) {
	return ['$timeout', '$parse', function($timeout, $parse) {
		var formDirective = {
			name: 'form',
			restrict: isNgForm ? 'EAC' : 'E',
			require: ['form', '^^?form'], //first is the form's own ctrl, second is an optional parent form
			controller: FormController,
			compile: function ngFormCompile(formElement, attr) {
				// Setup initial state of the control
				formElement.addClass(PRISTINE_CLASS).addClass(VALID_CLASS);

				var nameAttr = attr.name ? 'name' : (isNgForm && attr.ngForm ? 'ngForm' : false);

				return {
					pre: function ngFormPreLink(scope, formElement, attr, ctrls) {
						var controller = ctrls[0];

						// if `action` attr is not present on the form, prevent the default action (submission)
						if (!('action' in attr)) {
							// we can't use jq events because if a form is destroyed during submission the default
							// action is not prevented. see #1238
							//
							// IE 9 is not affected because it doesn't fire a submit event and try to do a full
							// page reload if the form was destroyed by submission of the form via a click handler
							// on a button in the form. Looks like an IE9 specific bug.
							var handleFormSubmission = function(event) {
								scope.$apply(function() {
									controller.$commitViewValue();
									controller.$setSubmitted();
								});

								event.preventDefault();
							};

							addEventListenerFn(formElement[0], 'submit', handleFormSubmission);

							// unregister the preventDefault listener so that we don't not leak memory but in a
							// way that will achieve the prevention of the default action.
							formElement.on('$destroy', function() {
								$timeout(function() {
									removeEventListenerFn(formElement[0], 'submit', handleFormSubmission);
								}, 0, false);
							});
						}

						var parentFormCtrl = ctrls[1] || controller.$$parentForm;
						parentFormCtrl.$addControl(controller);

						var setter = nameAttr ? getSetter(controller.$name) : noop;

						if (nameAttr) {
							setter(scope, controller);
							attr.$observe(nameAttr, function(newValue) {
								if (controller.$name === newValue) return;
								setter(scope, undefined);
								controller.$$parentForm.$$renameControl(controller, newValue);
								setter = getSetter(controller.$name);
								setter(scope, controller);
							});
						}
						formElement.on('$destroy', function() {
							controller.$$parentForm.$removeControl(controller);
							setter(scope, undefined);
							extend(controller, nullFormCtrl); //stop propagating child destruction handlers upwards
						});
					}
				};
			}
		};

		return formDirective;

		function getSetter(expression) {
			if (expression === '') {
				//create an assignable expression, so forms with an empty name can be renamed later
				return $parse('this[""]').assign;
			}
			return $parse(expression).assign || noop;
		}
	}];
};

var formDirective = formDirectiveFactory();
var ngFormDirective = formDirectiveFactory(true);

// Regex code was initially obtained from SO prior to modification: https://stackoverflow.com/questions/3143070/javascript-regex-iso-datetime#answer-3143231
var ISO_DATE_REGEXP = /^\d{4,}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+(?:[+-][0-2]\d:[0-5]\d|Z)$/;
// See valid URLs in RFC3987 (http://tools.ietf.org/html/rfc3987)
// Note: We are being more lenient, because browsers are too.
//   1. Scheme
//   2. Slashes
//   3. Username
//   4. Password
//   5. Hostname
//   6. Port
//   7. Path
//   8. Query
//   9. Fragment
//                 1111111111111111 222   333333    44444        555555555555555555555555    666     77777777     8888888     999
var URL_REGEXP = /^[a-z][a-z\d.+-]*:\/*(?:[^:@]+(?::[^@]+)?@)?(?:[^\s:/?#]+|\[[a-f\d:]+\])(?::\d+)?(?:\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i;
var EMAIL_REGEXP = /^[a-z0-9!#$%&'*+\/=?^_`{|}~.-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
var NUMBER_REGEXP = /^\s*(\-|\+)?(\d+|(\d*(\.\d*)))([eE][+-]?\d+)?\s*$/;
var DATE_REGEXP = /^(\d{4,})-(\d{2})-(\d{2})$/;
var DATETIMELOCAL_REGEXP = /^(\d{4,})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(\.\d{1,3})?)?$/;
var WEEK_REGEXP = /^(\d{4,})-W(\d\d)$/;
var MONTH_REGEXP = /^(\d{4,})-(\d\d)$/;
var TIME_REGEXP = /^(\d\d):(\d\d)(?::(\d\d)(\.\d{1,3})?)?$/;

var PARTIAL_VALIDATION_EVENTS = 'keydown wheel mousedown';
var PARTIAL_VALIDATION_TYPES = createMap();
forEach('date,datetime-local,month,time,week'.split(','), function(type) {
  PARTIAL_VALIDATION_TYPES[type] = true;
});

var inputType = {
	'text': textInputType,

	'date': createDateInputType('date', DATE_REGEXP,
				 createDateParser(DATE_REGEXP, ['yyyy', 'MM', 'dd']),
				 'yyyy-MM-dd'),

	'datetime-local': createDateInputType('datetimelocal', DATETIMELOCAL_REGEXP,
			createDateParser(DATETIMELOCAL_REGEXP, ['yyyy', 'MM', 'dd', 'HH', 'mm', 'ss', 'sss']),
			'yyyy-MM-ddTHH:mm:ss.sss'),

	'time': createDateInputType('time', TIME_REGEXP,
			createDateParser(TIME_REGEXP, ['HH', 'mm', 'ss', 'sss']),
		 'HH:mm:ss.sss'),

	'week': createDateInputType('week', WEEK_REGEXP, weekParser, 'yyyy-Www'),

	'month': createDateInputType('month', MONTH_REGEXP,
		 createDateParser(MONTH_REGEXP, ['yyyy', 'MM']),
		 'yyyy-MM'),

	'number': numberInputType,

	'url': urlInputType,

	'email': emailInputType,

	'radio': radioInputType,

	'checkbox': checkboxInputType,

	'hidden': noop,
	'button': noop,
	'submit': noop,
	'reset': noop,
	'file': noop
};

function stringBasedInputType(ctrl) {
	ctrl.$formatters.push(function(value) {
		return ctrl.$isEmpty(value) ? value : value.toString();
	});
}

function textInputType(scope, element, attr, ctrl, $sniffer, $browser) {
	baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
	stringBasedInputType(ctrl);
}

function baseInputType(scope, element, attr, ctrl, $sniffer, $browser) {
	var type = lowercase(element[0].type);

	// In composition mode, users are still inputing intermediate text buffer,
	// hold the listener until composition is done.
	// More about composition events: https://developer.mozilla.org/en-US/docs/Web/API/CompositionEvent
	if (!$sniffer.android) {
		var composing = false;

		element.on('compositionstart', function() {
			composing = true;
		});

		element.on('compositionend', function() {
			composing = false;
			listener();
		});
	}

	var timeout;

	var listener = function(ev) {
		if (timeout) {
			$browser.defer.cancel(timeout);
			timeout = null;
		}
		if (composing) return;
		var value = element.val(),
				event = ev && ev.type;

		// By default we will trim the value
		// If the attribute ng-trim exists we will avoid trimming
		// If input type is 'password', the value is never trimmed
		if (type !== 'password' && (!attr.ngTrim || attr.ngTrim !== 'false')) {
			value = trim(value);
		}

		// If a control is suffering from bad input (due to native validators), browsers discard its
		// value, so it may be necessary to revalidate (by calling $setViewValue again) even if the
		// control's value is the same empty value twice in a row.
		if (ctrl.$viewValue !== value || (value === '' && ctrl.$$hasNativeValidators)) {
			ctrl.$setViewValue(value, event);
		}
	};

	// if the browser does support "input" event, we are fine - except on IE9 which doesn't fire the
	// input event on backspace, delete or cut
	if ($sniffer.hasEvent('input')) {
		element.on('input', listener);
	} else {
		var deferListener = function(ev, input, origValue) {
			if (!timeout) {
				timeout = $browser.defer(function() {
					timeout = null;
					if (!input || input.value !== origValue) {
						listener(ev);
					}
				});
			}
		};

		element.on('keydown', function(event) {
			var key = event.keyCode;

			// ignore
			//    command            modifiers                   arrows
			if (key === 91 || (15 < key && key < 19) || (37 <= key && key <= 40)) return;

			deferListener(event, this, this.value);
		});

		// if user modifies input value using context menu in IE, we need "paste" and "cut" events to catch it
		if ($sniffer.hasEvent('paste')) {
			element.on('paste cut', deferListener);
		}
	}

	// if user paste into input using mouse on older browser
	// or form autocomplete on newer browser, we need "change" event to catch it
	element.on('change', listener);

	// Some native input types (date-family) have the ability to change validity without
	// firing any input/change events.
	// For these event types, when native validators are present and the browser supports the type,
	// check for validity changes on various DOM events.
	if (PARTIAL_VALIDATION_TYPES[type] && ctrl.$$hasNativeValidators && type === attr.type) {
		element.on(PARTIAL_VALIDATION_EVENTS, function(ev) {
			if (!timeout) {
				var validity = this[VALIDITY_STATE_PROPERTY];
				var origBadInput = validity.badInput;
				var origTypeMismatch = validity.typeMismatch;
				timeout = $browser.defer(function() {
					timeout = null;
					if (validity.badInput !== origBadInput || validity.typeMismatch !== origTypeMismatch) {
						listener(ev);
					}
				});
			}
		});
	}

	ctrl.$render = function() {
		// Workaround for Firefox validation #12102.
		var value = ctrl.$isEmpty(ctrl.$viewValue) ? '' : ctrl.$viewValue;
		if (element.val() !== value) {
			element.val(value);
		}
	};
}

function weekParser(isoWeek, existingDate) {
	if (isDate(isoWeek)) {
		return isoWeek;
	}

	if (isString(isoWeek)) {
		WEEK_REGEXP.lastIndex = 0;
		var parts = WEEK_REGEXP.exec(isoWeek);
		if (parts) {
			var year = +parts[1],
					week = +parts[2],
					hours = 0,
					minutes = 0,
					seconds = 0,
					milliseconds = 0,
					firstThurs = getFirstThursdayOfYear(year),
					addDays = (week - 1) * 7;

			if (existingDate) {
				hours = existingDate.getHours();
				minutes = existingDate.getMinutes();
				seconds = existingDate.getSeconds();
				milliseconds = existingDate.getMilliseconds();
			}

			return new Date(year, 0, firstThurs.getDate() + addDays, hours, minutes, seconds, milliseconds);
		}
	}

	return NaN;
}

function createDateParser(regexp, mapping) {
	return function(iso, date) {
		var parts, map;

		if (isDate(iso)) {
			return iso;
		}

		if (isString(iso)) {
			// When a date is JSON'ified to wraps itself inside of an extra
			// set of double quotes. This makes the date parsing code unable
			// to match the date string and parse it as a date.
			if (iso.charAt(0) == '"' && iso.charAt(iso.length - 1) == '"') {
				iso = iso.substring(1, iso.length - 1);
			}
			if (ISO_DATE_REGEXP.test(iso)) {
				return new Date(iso);
			}
			regexp.lastIndex = 0;
			parts = regexp.exec(iso);

			if (parts) {
				parts.shift();
				if (date) {
					map = {
						yyyy: date.getFullYear(),
						MM: date.getMonth() + 1,
						dd: date.getDate(),
						HH: date.getHours(),
						mm: date.getMinutes(),
						ss: date.getSeconds(),
						sss: date.getMilliseconds() / 1000
					};
				} else {
					map = { yyyy: 1970, MM: 1, dd: 1, HH: 0, mm: 0, ss: 0, sss: 0 };
				}

				forEach(parts, function(part, index) {
					if (index < mapping.length) {
						map[mapping[index]] = +part;
					}
				});
				return new Date(map.yyyy, map.MM - 1, map.dd, map.HH, map.mm, map.ss || 0, map.sss * 1000 || 0);
			}
		}

		return NaN;
	};
}

function createDateInputType(type, regexp, parseDate, format) {
	return function dynamicDateInputType(scope, element, attr, ctrl, $sniffer, $browser, $filter) {
		badInputChecker(scope, element, attr, ctrl);
		baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
		var timezone = ctrl && ctrl.$options && ctrl.$options.timezone;
		var previousDate;

		ctrl.$$parserName = type;
		ctrl.$parsers.push(function(value) {
			if (ctrl.$isEmpty(value)) return null;
			if (regexp.test(value)) {
				// Note: We cannot read ctrl.$modelValue, as there might be a different
				// parser/formatter in the processing chain so that the model
				// contains some different data format!
				var parsedDate = parseDate(value, previousDate);
				if (timezone) {
					parsedDate = convertTimezoneToLocal(parsedDate, timezone);
				}
				return parsedDate;
			}
			return undefined;
		});

		ctrl.$formatters.push(function(value) {
			if (value && !isDate(value)) {
				throw ngModelMinErr('datefmt', 'Expected `{0}` to be a date', value);
			}
			if (isValidDate(value)) {
				previousDate = value;
				if (previousDate && timezone) {
					previousDate = convertTimezoneToLocal(previousDate, timezone, true);
				}
				return $filter('date')(value, format, timezone);
			} else {
				previousDate = null;
				return '';
			}
		});

		if (isDefined(attr.min) || attr.ngMin) {
			var minVal;
			ctrl.$validators.min = function(value) {
				return !isValidDate(value) || isUndefined(minVal) || parseDate(value) >= minVal;
			};
			attr.$observe('min', function(val) {
				minVal = parseObservedDateValue(val);
				ctrl.$validate();
			});
		}

		if (isDefined(attr.max) || attr.ngMax) {
			var maxVal;
			ctrl.$validators.max = function(value) {
				return !isValidDate(value) || isUndefined(maxVal) || parseDate(value) <= maxVal;
			};
			attr.$observe('max', function(val) {
				maxVal = parseObservedDateValue(val);
				ctrl.$validate();
			});
		}

		function isValidDate(value) {
			// Invalid Date: getTime() returns NaN
			return value && !(value.getTime && value.getTime() !== value.getTime());
		}

		function parseObservedDateValue(val) {
			return isDefined(val) && !isDate(val) ? parseDate(val) || undefined : val;
		}
	};
}

function badInputChecker(scope, element, attr, ctrl) {
	var node = element[0];
	var nativeValidation = ctrl.$$hasNativeValidators = isObject(node.validity);
	if (nativeValidation) {
		ctrl.$parsers.push(function(value) {
			var validity = element.prop(VALIDITY_STATE_PROPERTY) || {};
			return validity.badInput || validity.typeMismatch ? undefined : value;
		});
	}
}

function numberInputType(scope, element, attr, ctrl, $sniffer, $browser) {
	badInputChecker(scope, element, attr, ctrl);
	baseInputType(scope, element, attr, ctrl, $sniffer, $browser);

	ctrl.$$parserName = 'number';
	ctrl.$parsers.push(function(value) {
		if (ctrl.$isEmpty(value))      return null;
		if (NUMBER_REGEXP.test(value)) return parseFloat(value);
		return undefined;
	});

	ctrl.$formatters.push(function(value) {
		if (!ctrl.$isEmpty(value)) {
			if (!isNumber(value)) {
				throw ngModelMinErr('numfmt', 'Expected `{0}` to be a number', value);
			}
			value = value.toString();
		}
		return value;
	});

	if (isDefined(attr.min) || attr.ngMin) {
		var minVal;
		ctrl.$validators.min = function(value) {
			return ctrl.$isEmpty(value) || isUndefined(minVal) || value >= minVal;
		};

		attr.$observe('min', function(val) {
			if (isDefined(val) && !isNumber(val)) {
				val = parseFloat(val, 10);
			}
			minVal = isNumber(val) && !isNaN(val) ? val : undefined;
			// TODO(matsko): implement validateLater to reduce number of validations
			ctrl.$validate();
		});
	}

	if (isDefined(attr.max) || attr.ngMax) {
		var maxVal;
		ctrl.$validators.max = function(value) {
			return ctrl.$isEmpty(value) || isUndefined(maxVal) || value <= maxVal;
		};

		attr.$observe('max', function(val) {
			if (isDefined(val) && !isNumber(val)) {
				val = parseFloat(val, 10);
			}
			maxVal = isNumber(val) && !isNaN(val) ? val : undefined;
			// TODO(matsko): implement validateLater to reduce number of validations
			ctrl.$validate();
		});
	}
}

function urlInputType(scope, element, attr, ctrl, $sniffer, $browser) {
	// Note: no badInputChecker here by purpose as `url` is only a validation
	// in browsers, i.e. we can always read out input.value even if it is not valid!
	baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
	stringBasedInputType(ctrl);

	ctrl.$$parserName = 'url';
	ctrl.$validators.url = function(modelValue, viewValue) {
		var value = modelValue || viewValue;
		return ctrl.$isEmpty(value) || URL_REGEXP.test(value);
	};
}

function emailInputType(scope, element, attr, ctrl, $sniffer, $browser) {
	// Note: no badInputChecker here by purpose as `url` is only a validation
	// in browsers, i.e. we can always read out input.value even if it is not valid!
	baseInputType(scope, element, attr, ctrl, $sniffer, $browser);
	stringBasedInputType(ctrl);

	ctrl.$$parserName = 'email';
	ctrl.$validators.email = function(modelValue, viewValue) {
		var value = modelValue || viewValue;
		return ctrl.$isEmpty(value) || EMAIL_REGEXP.test(value);
	};
}

function radioInputType(scope, element, attr, ctrl) {
	// make the name unique, if not defined
	if (isUndefined(attr.name)) {
		element.attr('name', nextUid());
	}

	var listener = function(ev) {
		if (element[0].checked) {
			ctrl.$setViewValue(attr.value, ev && ev.type);
		}
	};

	element.on('click', listener);

	ctrl.$render = function() {
		var value = attr.value;
		element[0].checked = (value == ctrl.$viewValue);
	};

	attr.$observe('value', ctrl.$render);
}

function parseConstantExpr($parse, context, name, expression, fallback) {
	var parseFn;
	if (isDefined(expression)) {
		parseFn = $parse(expression);
		if (!parseFn.constant) {
			throw ngModelMinErr('constexpr', 'Expected constant expression for `{0}`, but saw ' +
																	 '`{1}`.', name, expression);
		}
		return parseFn(context);
	}
	return fallback;
}

function checkboxInputType(scope, element, attr, ctrl, $sniffer, $browser, $filter, $parse) {
	var trueValue = parseConstantExpr($parse, scope, 'ngTrueValue', attr.ngTrueValue, true);
	var falseValue = parseConstantExpr($parse, scope, 'ngFalseValue', attr.ngFalseValue, false);

	var listener = function(ev) {
		ctrl.$setViewValue(element[0].checked, ev && ev.type);
	};

	element.on('click', listener);

	ctrl.$render = function() {
		element[0].checked = ctrl.$viewValue;
	};

	// Override the standard `$isEmpty` because the $viewValue of an empty checkbox is always set to `false`
	// This is because of the parser below, which compares the `$modelValue` with `trueValue` to convert
	// it to a boolean.
	ctrl.$isEmpty = function(value) {
		return value === false;
	};

	ctrl.$formatters.push(function(value) {
		return equals(value, trueValue);
	});

	ctrl.$parsers.push(function(value) {
		return value ? trueValue : falseValue;
	});
}

var inputDirective = ['$browser', '$sniffer', '$filter', '$parse',
		function($browser, $sniffer, $filter, $parse) {
	return {
		restrict: 'E',
		require: ['?ngModel'],
		link: {
			pre: function(scope, element, attr, ctrls) {
				if (ctrls[0]) {
					(inputType[lowercase(attr.type)] || inputType.text)(scope, element, attr, ctrls[0], $sniffer,
																															$browser, $filter, $parse);
				}
			}
		}
	};
}];

var CONSTANT_VALUE_REGEXP = /^(true|false|\d+)$/;

var ngValueDirective = function() {
	return {
		restrict: 'A',
		priority: 100,
		compile: function(tpl, tplAttr) {
			if (CONSTANT_VALUE_REGEXP.test(tplAttr.ngValue)) {
				return function ngValueConstantLink(scope, elm, attr) {
					attr.$set('value', scope.$eval(attr.ngValue));
				};
			} else {
				return function ngValueLink(scope, elm, attr) {
					scope.$watch(attr.ngValue, function valueWatchAction(value) {
						attr.$set('value', value);
					});
				};
			}
		}
	};
};

var ngBindDirective = ['$compile', function($compile) {
	return {
		restrict: 'AC',
		compile: function ngBindCompile(templateElement) {
			$compile.$$addBindingClass(templateElement);
			return function ngBindLink(scope, element, attr) {
				$compile.$$addBindingInfo(element, attr.ngBind);
				element = element[0];
				scope.$watch(attr.ngBind, function ngBindWatchAction(value) {
					element.textContent = isUndefined(value) ? '' : value;
				});
			};
		}
	};
}];

var ngBindTemplateDirective = ['$interpolate', '$compile', function($interpolate, $compile) {
	return {
		compile: function ngBindTemplateCompile(templateElement) {
			$compile.$$addBindingClass(templateElement);
			return function ngBindTemplateLink(scope, element, attr) {
				var interpolateFn = $interpolate(element.attr(attr.$attr.ngBindTemplate));
				$compile.$$addBindingInfo(element, interpolateFn.expressions);
				element = element[0];
				attr.$observe('ngBindTemplate', function(value) {
					element.textContent = isUndefined(value) ? '' : value;
				});
			};
		}
	};
}];

var ngBindHtmlDirective = ['$sce', '$parse', '$compile', function($sce, $parse, $compile) {
	return {
		restrict: 'A',
		compile: function ngBindHtmlCompile(tElement, tAttrs) {
			var ngBindHtmlGetter = $parse(tAttrs.ngBindHtml);
			var ngBindHtmlWatch = $parse(tAttrs.ngBindHtml, function sceValueOf(val) {
				// Unwrap the value to compare the actual inner safe value, not the wrapper object.
				return $sce.valueOf(val);
			});
			$compile.$$addBindingClass(tElement);

			return function ngBindHtmlLink(scope, element, attr) {
				$compile.$$addBindingInfo(element, attr.ngBindHtml);

				scope.$watch(ngBindHtmlWatch, function ngBindHtmlWatchAction() {
					// The watched value is the unwrapped value. To avoid re-escaping, use the direct getter.
					var value = ngBindHtmlGetter(scope);
					element.html($sce.getTrustedHtml(value) || '');
				});
			};
		}
	};
}];

var ngChangeDirective = valueFn({
	restrict: 'A',
	require: 'ngModel',
	link: function(scope, element, attr, ctrl) {
		ctrl.$viewChangeListeners.push(function() {
			scope.$eval(attr.ngChange);
		});
	}
});

function classDirective(name, selector) {
	name = 'ngClass' + name;
	return ['$animate', function($animate) {
		return {
			restrict: 'AC',
			link: function(scope, element, attr) {
				var oldVal;

				scope.$watch(attr[name], ngClassWatchAction, true);

				attr.$observe('class', function(value) {
					ngClassWatchAction(scope.$eval(attr[name]));
				});

				if (name !== 'ngClass') {
					scope.$watch('$index', function($index, old$index) {
						// jshint bitwise: false
						var mod = $index & 1;
						if (mod !== (old$index & 1)) {
							var classes = arrayClasses(scope.$eval(attr[name]));
							mod === selector ?
								addClasses(classes) :
								removeClasses(classes);
						}
					});
				}

				function addClasses(classes) {
					var newClasses = digestClassCounts(classes, 1);
					attr.$addClass(newClasses);
				}

				function removeClasses(classes) {
					var newClasses = digestClassCounts(classes, -1);
					attr.$removeClass(newClasses);
				}

				function digestClassCounts(classes, count) {
					// Use createMap() to prevent class assumptions involving property
					// names in Object.prototype
					var classCounts = element.data('$classCounts') || createMap();
					var classesToUpdate = [];
					forEach(classes, function(className) {
						if (count > 0 || classCounts[className]) {
							classCounts[className] = (classCounts[className] || 0) + count;
							if (classCounts[className] === +(count > 0)) {
								classesToUpdate.push(className);
							}
						}
					});
					element.data('$classCounts', classCounts);
					return classesToUpdate.join(' ');
				}

				function updateClasses(oldClasses, newClasses) {
					var toAdd = arrayDifference(newClasses, oldClasses);
					var toRemove = arrayDifference(oldClasses, newClasses);
					toAdd = digestClassCounts(toAdd, 1);
					toRemove = digestClassCounts(toRemove, -1);
					if (toAdd && toAdd.length) {
						$animate.addClass(element, toAdd);
					}
					if (toRemove && toRemove.length) {
						$animate.removeClass(element, toRemove);
					}
				}

				function ngClassWatchAction(newVal) {
					// jshint bitwise: false
					if (selector === true || (scope.$index & 1) === selector) {
					// jshint bitwise: true
						var newClasses = arrayClasses(newVal || []);
						if (!oldVal) {
							addClasses(newClasses);
						} else if (!equals(newVal,oldVal)) {
							var oldClasses = arrayClasses(oldVal);
							updateClasses(oldClasses, newClasses);
						}
					}
					if (isArray(newVal)) {
						oldVal = newVal.map(function(v) { return shallowCopy(v); });
					} else {
						oldVal = shallowCopy(newVal);
					}
				}
			}
		};

		function arrayDifference(tokens1, tokens2) {
			var values = [];

			outer:
			for (var i = 0; i < tokens1.length; i++) {
				var token = tokens1[i];
				for (var j = 0; j < tokens2.length; j++) {
					if (token == tokens2[j]) continue outer;
				}
				values.push(token);
			}
			return values;
		}

		function arrayClasses(classVal) {
			var classes = [];
			if (isArray(classVal)) {
				forEach(classVal, function(v) {
					classes = classes.concat(arrayClasses(v));
				});
				return classes;
			} else if (isString(classVal)) {
				return classVal.split(' ');
			} else if (isObject(classVal)) {
				forEach(classVal, function(v, k) {
					if (v) {
						classes = classes.concat(k.split(' '));
					}
				});
				return classes;
			}
			return classVal;
		}
	}];
}

var ngClassDirective = classDirective('', true);

var ngClassOddDirective = classDirective('Odd', 0);

var ngClassEvenDirective = classDirective('Even', 1);

var ngCloakDirective = ngDirective({
	compile: function(element, attr) {
		attr.$set('ngCloak', undefined);
		element.removeClass('ng-cloak');
	}
});

var ngControllerDirective = [function() {
	return {
		restrict: 'A',
		scope: true,
		controller: '@',
		priority: 500
	};
}];

// ngCsp is not implemented as a proper directive any more, because we need it be processed while we
// bootstrap the system (before $parse is instantiated), for this reason we just have
// the csp() fn that looks for the `ng-csp` attribute anywhere in the current doc

var ngEventDirectives = {};

// For events that might fire synchronously during DOM manipulation
// we need to execute their event handlers asynchronously using $evalAsync,
// so that they are not executed in an inconsistent state.
var forceAsyncEvents = {
	'blur': true,
	'focus': true
};
forEach(
	'click dblclick mousedown mouseup mouseover mouseout mousemove mouseenter mouseleave keydown keyup keypress submit focus blur copy cut paste'.split(' '),
	function(eventName) {
		var directiveName = directiveNormalize('ng-' + eventName);
		ngEventDirectives[directiveName] = ['$parse', '$rootScope', function($parse, $rootScope) {
			return {
				restrict: 'A',
				compile: function($element, attr) {
					// We expose the powerful $event object on the scope that provides access to the Window,
					// etc. that isn't protected by the fast paths in $parse.  We explicitly request better
					// checks at the cost of speed since event handler expressions are not executed as
					// frequently as regular change detection.
					var fn = $parse(attr[directiveName],  null,  true);
					return function ngEventHandler(scope, element) {
						element.on(eventName, function(event) {
							var callback = function() {
								fn(scope, {$event:event});
							};
							if (forceAsyncEvents[eventName] && $rootScope.$$phase) {
								scope.$evalAsync(callback);
							} else {
								scope.$apply(callback);
							}
						});
					};
				}
			};
		}];
	}
);

var ngIfDirective = ['$animate', '$compile', function($animate, $compile) {
	return {
		multiElement: true,
		transclude: 'element',
		priority: 600,
		terminal: true,
		restrict: 'A',
		$$tlb: true,
		link: function($scope, $element, $attr, ctrl, $transclude) {
				var block, childScope, previousElements;
				$scope.$watch($attr.ngIf, function ngIfWatchAction(value) {

					if (value) {
						if (!childScope) {
							$transclude(function(clone, newScope) {
								childScope = newScope;
								clone[clone.length++] = $compile.$$createComment('end ngIf', $attr.ngIf);
								// Note: We only need the first/last node of the cloned nodes.
								// However, we need to keep the reference to the jqlite wrapper as it might be changed later
								// by a directive with templateUrl when its template arrives.
								block = {
									clone: clone
								};
								$animate.enter(clone, $element.parent(), $element);
							});
						}
					} else {
						if (previousElements) {
							previousElements.remove();
							previousElements = null;
						}
						if (childScope) {
							childScope.$destroy();
							childScope = null;
						}
						if (block) {
							previousElements = getBlockNodes(block.clone);
							$animate.leave(previousElements).then(function() {
								previousElements = null;
							});
							block = null;
						}
					}
				});
		}
	};
}];

var ngIncludeDirective = ['$templateRequest', '$anchorScroll', '$animate',
									function($templateRequest,   $anchorScroll,   $animate) {
	return {
		restrict: 'ECA',
		priority: 400,
		terminal: true,
		transclude: 'element',
		controller: angular.noop,
		compile: function(element, attr) {
			var srcExp = attr.ngInclude || attr.src,
					onloadExp = attr.onload || '',
					autoScrollExp = attr.autoscroll;

			return function(scope, $element, $attr, ctrl, $transclude) {
				var changeCounter = 0,
						currentScope,
						previousElement,
						currentElement;

				var cleanupLastIncludeContent = function() {
					if (previousElement) {
						previousElement.remove();
						previousElement = null;
					}
					if (currentScope) {
						currentScope.$destroy();
						currentScope = null;
					}
					if (currentElement) {
						$animate.leave(currentElement).then(function() {
							previousElement = null;
						});
						previousElement = currentElement;
						currentElement = null;
					}
				};

				scope.$watch(srcExp, function ngIncludeWatchAction(src) {
					var afterAnimation = function() {
						if (isDefined(autoScrollExp) && (!autoScrollExp || scope.$eval(autoScrollExp))) {
							$anchorScroll();
						}
					};
					var thisChangeId = ++changeCounter;

					if (src) {
						//set the 2nd param to true to ignore the template request error so that the inner
						//contents and scope can be cleaned up.
						$templateRequest(src, true).then(function(response) {
							if (scope.$$destroyed) return;

							if (thisChangeId !== changeCounter) return;
							var newScope = scope.$new();
							ctrl.template = response;

							// Note: This will also link all children of ng-include that were contained in the original
							// html. If that content contains controllers, ... they could pollute/change the scope.
							// However, using ng-include on an element with additional content does not make sense...
							// Note: We can't remove them in the cloneAttchFn of $transclude as that
							// function is called before linking the content, which would apply child
							// directives to non existing elements.
							var clone = $transclude(newScope, function(clone) {
								cleanupLastIncludeContent();
								$animate.enter(clone, null, $element).then(afterAnimation);
							});

							currentScope = newScope;
							currentElement = clone;

							currentScope.$emit('$includeContentLoaded', src);
							scope.$eval(onloadExp);
						}, function() {
							if (scope.$$destroyed) return;

							if (thisChangeId === changeCounter) {
								cleanupLastIncludeContent();
								scope.$emit('$includeContentError', src);
							}
						});
						scope.$emit('$includeContentRequested', src);
					} else {
						cleanupLastIncludeContent();
						ctrl.template = null;
					}
				});
			};
		}
	};
}];

// This directive is called during the $transclude call of the first `ngInclude` directive.
// It will replace and compile the content of the element with the loaded template.
// We need this directive so that the element content is already filled when
// the link function of another directive on the same element as ngInclude
// is called.
var ngIncludeFillContentDirective = ['$compile',
	function($compile) {
		return {
			restrict: 'ECA',
			priority: -400,
			require: 'ngInclude',
			link: function(scope, $element, $attr, ctrl) {
				if (toString.call($element[0]).match(/SVG/)) {
					// WebKit: https://bugs.webkit.org/show_bug.cgi?id=135698 --- SVG elements do not
					// support innerHTML, so detect this here and try to generate the contents
					// specially.
					$element.empty();
					$compile(jqLiteBuildFragment(ctrl.template, window.document).childNodes)(scope,
							function namespaceAdaptedClone(clone) {
						$element.append(clone);
					}, {futureParentElement: $element});
					return;
				}

				$element.html(ctrl.template);
				$compile($element.contents())(scope);
			}
		};
	}];

var ngInitDirective = ngDirective({
	priority: 450,
	compile: function() {
		return {
			pre: function(scope, element, attrs) {
				scope.$eval(attrs.ngInit);
			}
		};
	}
});

var ngListDirective = function() {
	return {
		restrict: 'A',
		priority: 100,
		require: 'ngModel',
		link: function(scope, element, attr, ctrl) {
			// We want to control whitespace trimming so we use this convoluted approach
			// to access the ngList attribute, which doesn't pre-trim the attribute
			var ngList = element.attr(attr.$attr.ngList) || ', ';
			var trimValues = attr.ngTrim !== 'false';
			var separator = trimValues ? trim(ngList) : ngList;

			var parse = function(viewValue) {
				// If the viewValue is invalid (say required but empty) it will be `undefined`
				if (isUndefined(viewValue)) return;

				var list = [];

				if (viewValue) {
					forEach(viewValue.split(separator), function(value) {
						if (value) list.push(trimValues ? trim(value) : value);
					});
				}

				return list;
			};

			ctrl.$parsers.push(parse);
			ctrl.$formatters.push(function(value) {
				if (isArray(value)) {
					return value.join(ngList);
				}

				return undefined;
			});

			// Override the standard $isEmpty because an empty array means the input is empty.
			ctrl.$isEmpty = function(value) {
				return !value || !value.length;
			};
		}
	};
};

var VALID_CLASS = 'ng-valid',
		INVALID_CLASS = 'ng-invalid',
		PRISTINE_CLASS = 'ng-pristine',
		DIRTY_CLASS = 'ng-dirty',
		UNTOUCHED_CLASS = 'ng-untouched',
		TOUCHED_CLASS = 'ng-touched',
		PENDING_CLASS = 'ng-pending',
		EMPTY_CLASS = 'ng-empty',
		NOT_EMPTY_CLASS = 'ng-not-empty';

var ngModelMinErr = minErr('ngModel');

var NgModelController = ['$scope', '$exceptionHandler', '$attrs', '$element', '$parse', '$animate', '$timeout', '$rootScope', '$q', '$interpolate',
		function($scope, $exceptionHandler, $attr, $element, $parse, $animate, $timeout, $rootScope, $q, $interpolate) {
	this.$viewValue = Number.NaN;
	this.$modelValue = Number.NaN;
	this.$$rawModelValue = undefined; // stores the parsed modelValue / model set from scope regardless of validity.
	this.$validators = {};
	this.$asyncValidators = {};
	this.$parsers = [];
	this.$formatters = [];
	this.$viewChangeListeners = [];
	this.$untouched = true;
	this.$touched = false;
	this.$pristine = true;
	this.$dirty = false;
	this.$valid = true;
	this.$invalid = false;
	this.$error = {}; // keep invalid keys here
	this.$$success = {}; // keep valid keys here
	this.$pending = undefined; // keep pending keys here
	this.$name = $interpolate($attr.name || '', false)($scope);
	this.$$parentForm = nullFormCtrl;

	var parsedNgModel = $parse($attr.ngModel),
			parsedNgModelAssign = parsedNgModel.assign,
			ngModelGet = parsedNgModel,
			ngModelSet = parsedNgModelAssign,
			pendingDebounce = null,
			parserValid,
			ctrl = this;

	this.$$setOptions = function(options) {
		ctrl.$options = options;
		if (options && options.getterSetter) {
			var invokeModelGetter = $parse($attr.ngModel + '()'),
					invokeModelSetter = $parse($attr.ngModel + '($$$p)');

			ngModelGet = function($scope) {
				var modelValue = parsedNgModel($scope);
				if (isFunction(modelValue)) {
					modelValue = invokeModelGetter($scope);
				}
				return modelValue;
			};
			ngModelSet = function($scope, newValue) {
				if (isFunction(parsedNgModel($scope))) {
					invokeModelSetter($scope, {$$$p: newValue});
				} else {
					parsedNgModelAssign($scope, newValue);
				}
			};
		} else if (!parsedNgModel.assign) {
			throw ngModelMinErr('nonassign', "Expression '{0}' is non-assignable. Element: {1}",
					$attr.ngModel, startingTag($element));
		}
	};

	this.$render = noop;

	this.$isEmpty = function(value) {
		return isUndefined(value) || value === '' || value === null || value !== value;
	};

	this.$$updateEmptyClasses = function(value) {
		if (ctrl.$isEmpty(value)) {
			$animate.removeClass($element, NOT_EMPTY_CLASS);
			$animate.addClass($element, EMPTY_CLASS);
		} else {
			$animate.removeClass($element, EMPTY_CLASS);
			$animate.addClass($element, NOT_EMPTY_CLASS);
		}
	};

	var currentValidationRunId = 0;

	addSetValidityMethod({
		ctrl: this,
		$element: $element,
		set: function(object, property) {
			object[property] = true;
		},
		unset: function(object, property) {
			delete object[property];
		},
		$animate: $animate
	});

	this.$setPristine = function() {
		ctrl.$dirty = false;
		ctrl.$pristine = true;
		$animate.removeClass($element, DIRTY_CLASS);
		$animate.addClass($element, PRISTINE_CLASS);
	};

	this.$setDirty = function() {
		ctrl.$dirty = true;
		ctrl.$pristine = false;
		$animate.removeClass($element, PRISTINE_CLASS);
		$animate.addClass($element, DIRTY_CLASS);
		ctrl.$$parentForm.$setDirty();
	};

	this.$setUntouched = function() {
		ctrl.$touched = false;
		ctrl.$untouched = true;
		$animate.setClass($element, UNTOUCHED_CLASS, TOUCHED_CLASS);
	};

	this.$setTouched = function() {
		ctrl.$touched = true;
		ctrl.$untouched = false;
		$animate.setClass($element, TOUCHED_CLASS, UNTOUCHED_CLASS);
	};

	this.$rollbackViewValue = function() {
		$timeout.cancel(pendingDebounce);
		ctrl.$viewValue = ctrl.$$lastCommittedViewValue;
		ctrl.$render();
	};

	this.$validate = function() {
		// ignore $validate before model is initialized
		if (isNumber(ctrl.$modelValue) && isNaN(ctrl.$modelValue)) {
			return;
		}

		var viewValue = ctrl.$$lastCommittedViewValue;
		// Note: we use the $$rawModelValue as $modelValue might have been
		// set to undefined during a view -> model update that found validation
		// errors. We can't parse the view here, since that could change
		// the model although neither viewValue nor the model on the scope changed
		var modelValue = ctrl.$$rawModelValue;

		var prevValid = ctrl.$valid;
		var prevModelValue = ctrl.$modelValue;

		var allowInvalid = ctrl.$options && ctrl.$options.allowInvalid;

		ctrl.$$runValidators(modelValue, viewValue, function(allValid) {
			// If there was no change in validity, don't update the model
			// This prevents changing an invalid modelValue to undefined
			if (!allowInvalid && prevValid !== allValid) {
				// Note: Don't check ctrl.$valid here, as we could have
				// external validators (e.g. calculated on the server),
				// that just call $setValidity and need the model value
				// to calculate their validity.
				ctrl.$modelValue = allValid ? modelValue : undefined;

				if (ctrl.$modelValue !== prevModelValue) {
					ctrl.$$writeModelToScope();
				}
			}
		});

	};

	this.$$runValidators = function(modelValue, viewValue, doneCallback) {
		currentValidationRunId++;
		var localValidationRunId = currentValidationRunId;

		// check parser error
		if (!processParseErrors()) {
			validationDone(false);
			return;
		}
		if (!processSyncValidators()) {
			validationDone(false);
			return;
		}
		processAsyncValidators();

		function processParseErrors() {
			var errorKey = ctrl.$$parserName || 'parse';
			if (isUndefined(parserValid)) {
				setValidity(errorKey, null);
			} else {
				if (!parserValid) {
					forEach(ctrl.$validators, function(v, name) {
						setValidity(name, null);
					});
					forEach(ctrl.$asyncValidators, function(v, name) {
						setValidity(name, null);
					});
				}
				// Set the parse error last, to prevent unsetting it, should a $validators key == parserName
				setValidity(errorKey, parserValid);
				return parserValid;
			}
			return true;
		}

		function processSyncValidators() {
			var syncValidatorsValid = true;
			forEach(ctrl.$validators, function(validator, name) {
				var result = validator(modelValue, viewValue);
				syncValidatorsValid = syncValidatorsValid && result;
				setValidity(name, result);
			});
			if (!syncValidatorsValid) {
				forEach(ctrl.$asyncValidators, function(v, name) {
					setValidity(name, null);
				});
				return false;
			}
			return true;
		}

		function processAsyncValidators() {
			var validatorPromises = [];
			var allValid = true;
			forEach(ctrl.$asyncValidators, function(validator, name) {
				var promise = validator(modelValue, viewValue);
				if (!isPromiseLike(promise)) {
					throw ngModelMinErr('nopromise',
						"Expected asynchronous validator to return a promise but got '{0}' instead.", promise);
				}
				setValidity(name, undefined);
				validatorPromises.push(promise.then(function() {
					setValidity(name, true);
				}, function() {
					allValid = false;
					setValidity(name, false);
				}));
			});
			if (!validatorPromises.length) {
				validationDone(true);
			} else {
				$q.all(validatorPromises).then(function() {
					validationDone(allValid);
				}, noop);
			}
		}

		function setValidity(name, isValid) {
			if (localValidationRunId === currentValidationRunId) {
				ctrl.$setValidity(name, isValid);
			}
		}

		function validationDone(allValid) {
			if (localValidationRunId === currentValidationRunId) {

				doneCallback(allValid);
			}
		}
	};

	this.$commitViewValue = function() {
		var viewValue = ctrl.$viewValue;

		$timeout.cancel(pendingDebounce);

		// If the view value has not changed then we should just exit, except in the case where there is
		// a native validator on the element. In this case the validation state may have changed even though
		// the viewValue has stayed empty.
		if (ctrl.$$lastCommittedViewValue === viewValue && (viewValue !== '' || !ctrl.$$hasNativeValidators)) {
			return;
		}
		ctrl.$$updateEmptyClasses(viewValue);
		ctrl.$$lastCommittedViewValue = viewValue;

		// change to dirty
		if (ctrl.$pristine) {
			this.$setDirty();
		}
		this.$$parseAndValidate();
	};

	this.$$parseAndValidate = function() {
		var viewValue = ctrl.$$lastCommittedViewValue;
		var modelValue = viewValue;
		parserValid = isUndefined(modelValue) ? undefined : true;

		if (parserValid) {
			for (var i = 0; i < ctrl.$parsers.length; i++) {
				modelValue = ctrl.$parsers[i](modelValue);
				if (isUndefined(modelValue)) {
					parserValid = false;
					break;
				}
			}
		}
		if (isNumber(ctrl.$modelValue) && isNaN(ctrl.$modelValue)) {
			// ctrl.$modelValue has not been touched yet...
			ctrl.$modelValue = ngModelGet($scope);
		}
		var prevModelValue = ctrl.$modelValue;
		var allowInvalid = ctrl.$options && ctrl.$options.allowInvalid;
		ctrl.$$rawModelValue = modelValue;

		if (allowInvalid) {
			ctrl.$modelValue = modelValue;
			writeToModelIfNeeded();
		}

		// Pass the $$lastCommittedViewValue here, because the cached viewValue might be out of date.
		// This can happen if e.g. $setViewValue is called from inside a parser
		ctrl.$$runValidators(modelValue, ctrl.$$lastCommittedViewValue, function(allValid) {
			if (!allowInvalid) {
				// Note: Don't check ctrl.$valid here, as we could have
				// external validators (e.g. calculated on the server),
				// that just call $setValidity and need the model value
				// to calculate their validity.
				ctrl.$modelValue = allValid ? modelValue : undefined;
				writeToModelIfNeeded();
			}
		});

		function writeToModelIfNeeded() {
			if (ctrl.$modelValue !== prevModelValue) {
				ctrl.$$writeModelToScope();
			}
		}
	};

	this.$$writeModelToScope = function() {
		ngModelSet($scope, ctrl.$modelValue);
		forEach(ctrl.$viewChangeListeners, function(listener) {
			try {
				listener();
			} catch (e) {
				$exceptionHandler(e);
			}
		});
	};

	this.$setViewValue = function(value, trigger) {
		ctrl.$viewValue = value;
		if (!ctrl.$options || ctrl.$options.updateOnDefault) {
			ctrl.$$debounceViewValueCommit(trigger);
		}
	};

	this.$$debounceViewValueCommit = function(trigger) {
		var debounceDelay = 0,
				options = ctrl.$options,
				debounce;

		if (options && isDefined(options.debounce)) {
			debounce = options.debounce;
			if (isNumber(debounce)) {
				debounceDelay = debounce;
			} else if (isNumber(debounce[trigger])) {
				debounceDelay = debounce[trigger];
			} else if (isNumber(debounce['default'])) {
				debounceDelay = debounce['default'];
			}
		}

		$timeout.cancel(pendingDebounce);
		if (debounceDelay) {
			pendingDebounce = $timeout(function() {
				ctrl.$commitViewValue();
			}, debounceDelay);
		} else if ($rootScope.$$phase) {
			ctrl.$commitViewValue();
		} else {
			$scope.$apply(function() {
				ctrl.$commitViewValue();
			});
		}
	};

	// model -> value
	// Note: we cannot use a normal scope.$watch as we want to detect the following:
	// 1. scope value is 'a'
	// 2. user enters 'b'
	// 3. ng-change kicks in and reverts scope value to 'a'
	//    -> scope value did not change since the last digest as
	//       ng-change executes in apply phase
	// 4. view should be changed back to 'a'
	$scope.$watch(function ngModelWatch() {
		var modelValue = ngModelGet($scope);

		// if scope model value and ngModel value are out of sync
		// TODO(perf): why not move this to the action fn?
		if (modelValue !== ctrl.$modelValue &&
			 // checks for NaN is needed to allow setting the model to NaN when there's an asyncValidator
			 (ctrl.$modelValue === ctrl.$modelValue || modelValue === modelValue)
		) {
			ctrl.$modelValue = ctrl.$$rawModelValue = modelValue;
			parserValid = undefined;

			var formatters = ctrl.$formatters,
					idx = formatters.length;

			var viewValue = modelValue;
			while (idx--) {
				viewValue = formatters[idx](viewValue);
			}
			if (ctrl.$viewValue !== viewValue) {
				ctrl.$$updateEmptyClasses(viewValue);
				ctrl.$viewValue = ctrl.$$lastCommittedViewValue = viewValue;
				ctrl.$render();

				ctrl.$$runValidators(modelValue, viewValue, noop);
			}
		}

		return modelValue;
	});
}];

var ngModelDirective = ['$rootScope', function($rootScope) {
	return {
		restrict: 'A',
		require: ['ngModel', '^?form', '^?ngModelOptions'],
		controller: NgModelController,
		// Prelink needs to run before any input directive
		// so that we can set the NgModelOptions in NgModelController
		// before anyone else uses it.
		priority: 1,
		compile: function ngModelCompile(element) {
			// Setup initial state of the control
			element.addClass(PRISTINE_CLASS).addClass(UNTOUCHED_CLASS).addClass(VALID_CLASS);

			return {
				pre: function ngModelPreLink(scope, element, attr, ctrls) {
					var modelCtrl = ctrls[0],
							formCtrl = ctrls[1] || modelCtrl.$$parentForm;

					modelCtrl.$$setOptions(ctrls[2] && ctrls[2].$options);

					// notify others, especially parent forms
					formCtrl.$addControl(modelCtrl);

					attr.$observe('name', function(newValue) {
						if (modelCtrl.$name !== newValue) {
							modelCtrl.$$parentForm.$$renameControl(modelCtrl, newValue);
						}
					});

					scope.$on('$destroy', function() {
						modelCtrl.$$parentForm.$removeControl(modelCtrl);
					});
				},
				post: function ngModelPostLink(scope, element, attr, ctrls) {
					var modelCtrl = ctrls[0];
					if (modelCtrl.$options && modelCtrl.$options.updateOn) {
						element.on(modelCtrl.$options.updateOn, function(ev) {
							modelCtrl.$$debounceViewValueCommit(ev && ev.type);
						});
					}

					element.on('blur', function() {
						if (modelCtrl.$touched) return;

						if ($rootScope.$$phase) {
							scope.$evalAsync(modelCtrl.$setTouched);
						} else {
							scope.$apply(modelCtrl.$setTouched);
						}
					});
				}
			};
		}
	};
}];

var DEFAULT_REGEXP = /(\s+|^)default(\s+|$)/;

var ngModelOptionsDirective = function() {
	return {
		restrict: 'A',
		controller: ['$scope', '$attrs', function($scope, $attrs) {
			var that = this;
			this.$options = copy($scope.$eval($attrs.ngModelOptions));
			// Allow adding/overriding bound events
			if (isDefined(this.$options.updateOn)) {
				this.$options.updateOnDefault = false;
				// extract "default" pseudo-event from list of events that can trigger a model update
				this.$options.updateOn = trim(this.$options.updateOn.replace(DEFAULT_REGEXP, function() {
					that.$options.updateOnDefault = true;
					return ' ';
				}));
			} else {
				this.$options.updateOnDefault = true;
			}
		}]
	};
};

// helper methods
function addSetValidityMethod(context) {
	var ctrl = context.ctrl,
			$element = context.$element,
			classCache = {},
			set = context.set,
			unset = context.unset,
			$animate = context.$animate;

	classCache[INVALID_CLASS] = !(classCache[VALID_CLASS] = $element.hasClass(VALID_CLASS));

	ctrl.$setValidity = setValidity;

	function setValidity(validationErrorKey, state, controller) {
		if (isUndefined(state)) {
			createAndSet('$pending', validationErrorKey, controller);
		} else {
			unsetAndCleanup('$pending', validationErrorKey, controller);
		}
		if (!isBoolean(state)) {
			unset(ctrl.$error, validationErrorKey, controller);
			unset(ctrl.$$success, validationErrorKey, controller);
		} else {
			if (state) {
				unset(ctrl.$error, validationErrorKey, controller);
				set(ctrl.$$success, validationErrorKey, controller);
			} else {
				set(ctrl.$error, validationErrorKey, controller);
				unset(ctrl.$$success, validationErrorKey, controller);
			}
		}
		if (ctrl.$pending) {
			cachedToggleClass(PENDING_CLASS, true);
			ctrl.$valid = ctrl.$invalid = undefined;
			toggleValidationCss('', null);
		} else {
			cachedToggleClass(PENDING_CLASS, false);
			ctrl.$valid = isObjectEmpty(ctrl.$error);
			ctrl.$invalid = !ctrl.$valid;
			toggleValidationCss('', ctrl.$valid);
		}

		// re-read the state as the set/unset methods could have
		// combined state in ctrl.$error[validationError] (used for forms),
		// where setting/unsetting only increments/decrements the value,
		// and does not replace it.
		var combinedState;
		if (ctrl.$pending && ctrl.$pending[validationErrorKey]) {
			combinedState = undefined;
		} else if (ctrl.$error[validationErrorKey]) {
			combinedState = false;
		} else if (ctrl.$$success[validationErrorKey]) {
			combinedState = true;
		} else {
			combinedState = null;
		}

		toggleValidationCss(validationErrorKey, combinedState);
		ctrl.$$parentForm.$setValidity(validationErrorKey, combinedState, ctrl);
	}

	function createAndSet(name, value, controller) {
		if (!ctrl[name]) {
			ctrl[name] = {};
		}
		set(ctrl[name], value, controller);
	}

	function unsetAndCleanup(name, value, controller) {
		if (ctrl[name]) {
			unset(ctrl[name], value, controller);
		}
		if (isObjectEmpty(ctrl[name])) {
			ctrl[name] = undefined;
		}
	}

	function cachedToggleClass(className, switchValue) {
		if (switchValue && !classCache[className]) {
			$animate.addClass($element, className);
			classCache[className] = true;
		} else if (!switchValue && classCache[className]) {
			$animate.removeClass($element, className);
			classCache[className] = false;
		}
	}

	function toggleValidationCss(validationErrorKey, isValid) {
		validationErrorKey = validationErrorKey ? '-' + snake_case(validationErrorKey, '-') : '';

		cachedToggleClass(VALID_CLASS + validationErrorKey, isValid === true);
		cachedToggleClass(INVALID_CLASS + validationErrorKey, isValid === false);
	}
}

function isObjectEmpty(obj) {
	if (obj) {
		for (var prop in obj) {
			if (obj.hasOwnProperty(prop)) {
				return false;
			}
		}
	}
	return true;
}

var ngNonBindableDirective = ngDirective({ terminal: true, priority: 1000 });

var ngOptionsMinErr = minErr('ngOptions');

// jshint maxlen: false
//                     //00001111111111000000000002222222222000000000000000000000333333333300000000000000000000000004444444444400000000000005555555555555550000000006666666666666660000000777777777777777000000000000000888888888800000000000000000009999999999
var NG_OPTIONS_REGEXP = /^\s*([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+group\s+by\s+([\s\S]+?))?(?:\s+disable\s+when\s+([\s\S]+?))?\s+for\s+(?:([\$\w][\$\w]*)|(?:\(\s*([\$\w][\$\w]*)\s*,\s*([\$\w][\$\w]*)\s*\)))\s+in\s+([\s\S]+?)(?:\s+track\s+by\s+([\s\S]+?))?$/;
												// 1: value expression (valueFn)
												// 2: label expression (displayFn)
												// 3: group by expression (groupByFn)
												// 4: disable when expression (disableWhenFn)
												// 5: array item variable name
												// 6: object item key variable name
												// 7: object item value variable name
												// 8: collection expression
												// 9: track by expression
// jshint maxlen: 100

var ngOptionsDirective = ['$compile', '$document', '$parse', function($compile, $document, $parse) {

	function parseOptionsExpression(optionsExp, selectElement, scope) {

		var match = optionsExp.match(NG_OPTIONS_REGEXP);
		if (!(match)) {
			throw ngOptionsMinErr('iexp',
				"Expected expression in form of " +
				"'_select_ (as _label_)? for (_key_,)?_value_ in _collection_'" +
				" but got '{0}'. Element: {1}",
				optionsExp, startingTag(selectElement));
		}

		// Extract the parts from the ngOptions expression

		// The variable name for the value of the item in the collection
		var valueName = match[5] || match[7];
		// The variable name for the key of the item in the collection
		var keyName = match[6];

		// An expression that generates the viewValue for an option if there is a label expression
		var selectAs = / as /.test(match[0]) && match[1];
		// An expression that is used to track the id of each object in the options collection
		var trackBy = match[9];
		// An expression that generates the viewValue for an option if there is no label expression
		var valueFn = $parse(match[2] ? match[1] : valueName);
		var selectAsFn = selectAs && $parse(selectAs);
		var viewValueFn = selectAsFn || valueFn;
		var trackByFn = trackBy && $parse(trackBy);

		// Get the value by which we are going to track the option
		// if we have a trackFn then use that (passing scope and locals)
		// otherwise just hash the given viewValue
		var getTrackByValueFn = trackBy ?
															function(value, locals) { return trackByFn(scope, locals); } :
															function getHashOfValue(value) { return hashKey(value); };
		var getTrackByValue = function(value, key) {
			return getTrackByValueFn(value, getLocals(value, key));
		};

		var displayFn = $parse(match[2] || match[1]);
		var groupByFn = $parse(match[3] || '');
		var disableWhenFn = $parse(match[4] || '');
		var valuesFn = $parse(match[8]);

		var locals = {};
		var getLocals = keyName ? function(value, key) {
			locals[keyName] = key;
			locals[valueName] = value;
			return locals;
		} : function(value) {
			locals[valueName] = value;
			return locals;
		};

		function Option(selectValue, viewValue, label, group, disabled) {
			this.selectValue = selectValue;
			this.viewValue = viewValue;
			this.label = label;
			this.group = group;
			this.disabled = disabled;
		}

		function getOptionValuesKeys(optionValues) {
			var optionValuesKeys;

			if (!keyName && isArrayLike(optionValues)) {
				optionValuesKeys = optionValues;
			} else {
				// if object, extract keys, in enumeration order, unsorted
				optionValuesKeys = [];
				for (var itemKey in optionValues) {
					if (optionValues.hasOwnProperty(itemKey) && itemKey.charAt(0) !== '$') {
						optionValuesKeys.push(itemKey);
					}
				}
			}
			return optionValuesKeys;
		}

		return {
			trackBy: trackBy,
			getTrackByValue: getTrackByValue,
			getWatchables: $parse(valuesFn, function(optionValues) {
				// Create a collection of things that we would like to watch (watchedArray)
				// so that they can all be watched using a single $watchCollection
				// that only runs the handler once if anything changes
				var watchedArray = [];
				optionValues = optionValues || [];

				var optionValuesKeys = getOptionValuesKeys(optionValues);
				var optionValuesLength = optionValuesKeys.length;
				for (var index = 0; index < optionValuesLength; index++) {
					var key = (optionValues === optionValuesKeys) ? index : optionValuesKeys[index];
					var value = optionValues[key];

					var locals = getLocals(value, key);
					var selectValue = getTrackByValueFn(value, locals);
					watchedArray.push(selectValue);

					// Only need to watch the displayFn if there is a specific label expression
					if (match[2] || match[1]) {
						var label = displayFn(scope, locals);
						watchedArray.push(label);
					}

					// Only need to watch the disableWhenFn if there is a specific disable expression
					if (match[4]) {
						var disableWhen = disableWhenFn(scope, locals);
						watchedArray.push(disableWhen);
					}
				}
				return watchedArray;
			}),

			getOptions: function() {

				var optionItems = [];
				var selectValueMap = {};

				// The option values were already computed in the `getWatchables` fn,
				// which must have been called to trigger `getOptions`
				var optionValues = valuesFn(scope) || [];
				var optionValuesKeys = getOptionValuesKeys(optionValues);
				var optionValuesLength = optionValuesKeys.length;

				for (var index = 0; index < optionValuesLength; index++) {
					var key = (optionValues === optionValuesKeys) ? index : optionValuesKeys[index];
					var value = optionValues[key];
					var locals = getLocals(value, key);
					var viewValue = viewValueFn(scope, locals);
					var selectValue = getTrackByValueFn(viewValue, locals);
					var label = displayFn(scope, locals);
					var group = groupByFn(scope, locals);
					var disabled = disableWhenFn(scope, locals);
					var optionItem = new Option(selectValue, viewValue, label, group, disabled);

					optionItems.push(optionItem);
					selectValueMap[selectValue] = optionItem;
				}

				return {
					items: optionItems,
					selectValueMap: selectValueMap,
					getOptionFromViewValue: function(value) {
						return selectValueMap[getTrackByValue(value)];
					},
					getViewValueFromOption: function(option) {
						// If the viewValue could be an object that may be mutated by the application,
						// we need to make a copy and not return the reference to the value on the option.
						return trackBy ? angular.copy(option.viewValue) : option.viewValue;
					}
				};
			}
		};
	}

	// we can't just jqLite('<option>') since jqLite is not smart enough
	// to create it in <select> and IE barfs otherwise.
	var optionTemplate = window.document.createElement('option'),
			optGroupTemplate = window.document.createElement('optgroup');

		function ngOptionsPostLink(scope, selectElement, attr, ctrls) {

			var selectCtrl = ctrls[0];
			var ngModelCtrl = ctrls[1];
			var multiple = attr.multiple;

			// The emptyOption allows the application developer to provide their own custom "empty"
			// option when the viewValue does not match any of the option values.
			var emptyOption;
			for (var i = 0, children = selectElement.children(), ii = children.length; i < ii; i++) {
				if (children[i].value === '') {
					emptyOption = children.eq(i);
					break;
				}
			}

			var providedEmptyOption = !!emptyOption;

			var unknownOption = jqLite(optionTemplate.cloneNode(false));
			unknownOption.val('?');

			var options;
			var ngOptions = parseOptionsExpression(attr.ngOptions, selectElement, scope);
			// This stores the newly created options before they are appended to the select.
			// Since the contents are removed from the fragment when it is appended,
			// we only need to create it once.
			var listFragment = $document[0].createDocumentFragment();

			var renderEmptyOption = function() {
				if (!providedEmptyOption) {
					selectElement.prepend(emptyOption);
				}
				selectElement.val('');
				emptyOption.prop('selected', true); // needed for IE
				emptyOption.attr('selected', true);
			};

			var removeEmptyOption = function() {
				if (!providedEmptyOption) {
					emptyOption.remove();
				}
			};

			var renderUnknownOption = function() {
				selectElement.prepend(unknownOption);
				selectElement.val('?');
				unknownOption.prop('selected', true); // needed for IE
				unknownOption.attr('selected', true);
			};

			var removeUnknownOption = function() {
				unknownOption.remove();
			};

			// Update the controller methods for multiple selectable options
			if (!multiple) {

				selectCtrl.writeValue = function writeNgOptionsValue(value) {
					var option = options.getOptionFromViewValue(value);

					if (option) {
						// Don't update the option when it is already selected.
						// For example, the browser will select the first option by default. In that case,
						// most properties are set automatically - except the `selected` attribute, which we
						// set always

						if (selectElement[0].value !== option.selectValue) {
							removeUnknownOption();
							removeEmptyOption();

							selectElement[0].value = option.selectValue;
							option.element.selected = true;
						}

						option.element.setAttribute('selected', 'selected');
					} else {
						if (value === null || providedEmptyOption) {
							removeUnknownOption();
							renderEmptyOption();
						} else {
							removeEmptyOption();
							renderUnknownOption();
						}
					}
				};

				selectCtrl.readValue = function readNgOptionsValue() {

					var selectedOption = options.selectValueMap[selectElement.val()];

					if (selectedOption && !selectedOption.disabled) {
						removeEmptyOption();
						removeUnknownOption();
						return options.getViewValueFromOption(selectedOption);
					}
					return null;
				};

				// If we are using `track by` then we must watch the tracked value on the model
				// since ngModel only watches for object identity change
				if (ngOptions.trackBy) {
					scope.$watch(
						function() { return ngOptions.getTrackByValue(ngModelCtrl.$viewValue); },
						function() { ngModelCtrl.$render(); }
					);
				}

			} else {

				ngModelCtrl.$isEmpty = function(value) {
					return !value || value.length === 0;
				};

				selectCtrl.writeValue = function writeNgOptionsMultiple(value) {
					options.items.forEach(function(option) {
						option.element.selected = false;
					});

					if (value) {
						value.forEach(function(item) {
							var option = options.getOptionFromViewValue(item);
							if (option) option.element.selected = true;
						});
					}
				};

				selectCtrl.readValue = function readNgOptionsMultiple() {
					var selectedValues = selectElement.val() || [],
							selections = [];

					forEach(selectedValues, function(value) {
						var option = options.selectValueMap[value];
						if (option && !option.disabled) selections.push(options.getViewValueFromOption(option));
					});

					return selections;
				};

				// If we are using `track by` then we must watch these tracked values on the model
				// since ngModel only watches for object identity change
				if (ngOptions.trackBy) {

					scope.$watchCollection(function() {
						if (isArray(ngModelCtrl.$viewValue)) {
							return ngModelCtrl.$viewValue.map(function(value) {
								return ngOptions.getTrackByValue(value);
							});
						}
					}, function() {
						ngModelCtrl.$render();
					});

				}
			}

			if (providedEmptyOption) {

				// we need to remove it before calling selectElement.empty() because otherwise IE will
				// remove the label from the element. wtf?
				emptyOption.remove();

				// compile the element since there might be bindings in it
				$compile(emptyOption)(scope);

				// remove the class, which is added automatically because we recompile the element and it
				// becomes the compilation root
				emptyOption.removeClass('ng-scope');
			} else {
				emptyOption = jqLite(optionTemplate.cloneNode(false));
			}

			selectElement.empty();

			// We need to do this here to ensure that the options object is defined
			// when we first hit it in writeNgOptionsValue
			updateOptions();

			// We will re-render the option elements if the option values or labels change
			scope.$watchCollection(ngOptions.getWatchables, updateOptions);

			// ------------------------------------------------------------------ //

			function addOptionElement(option, parent) {
				var optionElement = optionTemplate.cloneNode(false);
				parent.appendChild(optionElement);
				updateOptionElement(option, optionElement);
			}

			function updateOptionElement(option, element) {
				option.element = element;
				element.disabled = option.disabled;
				// NOTE: The label must be set before the value, otherwise IE10/11/EDGE create unresponsive
				// selects in certain circumstances when multiple selects are next to each other and display
				// the option list in listbox style, i.e. the select is [multiple], or specifies a [size].
				// See https://github.com/angular/angular.js/issues/11314 for more info.
				// This is unfortunately untestable with unit / e2e tests
				if (option.label !== element.label) {
					element.label = option.label;
					element.textContent = option.label;
				}
				if (option.value !== element.value) element.value = option.selectValue;
			}

			function updateOptions() {
				var previousValue = options && selectCtrl.readValue();

				// We must remove all current options, but cannot simply set innerHTML = null
				// since the providedEmptyOption might have an ngIf on it that inserts comments which we
				// must preserve.
				// Instead, iterate over the current option elements and remove them or their optgroup
				// parents
				if (options) {

					for (var i = options.items.length - 1; i >= 0; i--) {
						var option = options.items[i];
						if (option.group) {
							jqLiteRemove(option.element.parentNode);
						} else {
							jqLiteRemove(option.element);
						}
					}
				}

				options = ngOptions.getOptions();

				var groupElementMap = {};

				// Ensure that the empty option is always there if it was explicitly provided
				if (providedEmptyOption) {
					selectElement.prepend(emptyOption);
				}

				options.items.forEach(function addOption(option) {
					var groupElement;

					if (isDefined(option.group)) {

						// This option is to live in a group
						// See if we have already created this group
						groupElement = groupElementMap[option.group];

						if (!groupElement) {

							groupElement = optGroupTemplate.cloneNode(false);
							listFragment.appendChild(groupElement);

							// Update the label on the group element
							groupElement.label = option.group;

							// Store it for use later
							groupElementMap[option.group] = groupElement;
						}

						addOptionElement(option, groupElement);

					} else {

						// This option is not in a group
						addOptionElement(option, listFragment);
					}
				});

				selectElement[0].appendChild(listFragment);

				ngModelCtrl.$render();

				// Check to see if the value has changed due to the update to the options
				if (!ngModelCtrl.$isEmpty(previousValue)) {
					var nextValue = selectCtrl.readValue();
					var isNotPrimitive = ngOptions.trackBy || multiple;
					if (isNotPrimitive ? !equals(previousValue, nextValue) : previousValue !== nextValue) {
						ngModelCtrl.$setViewValue(nextValue);
						ngModelCtrl.$render();
					}
				}

			}
	}

	return {
		restrict: 'A',
		terminal: true,
		require: ['select', 'ngModel'],
		link: {
			pre: function ngOptionsPreLink(scope, selectElement, attr, ctrls) {
				// Deactivate the SelectController.register method to prevent
				// option directives from accidentally registering themselves
				// (and unwanted $destroy handlers etc.)
				ctrls[0].registerOption = noop;
			},
			post: ngOptionsPostLink
		}
	};
}];

var ngPluralizeDirective = ['$locale', '$interpolate', '$log', function($locale, $interpolate, $log) {
	var BRACE = /{}/g,
			IS_WHEN = /^when(Minus)?(.+)$/;

	return {
		link: function(scope, element, attr) {
			var numberExp = attr.count,
					whenExp = attr.$attr.when && element.attr(attr.$attr.when), // we have {{}} in attrs
					offset = attr.offset || 0,
					whens = scope.$eval(whenExp) || {},
					whensExpFns = {},
					startSymbol = $interpolate.startSymbol(),
					endSymbol = $interpolate.endSymbol(),
					braceReplacement = startSymbol + numberExp + '-' + offset + endSymbol,
					watchRemover = angular.noop,
					lastCount;

			forEach(attr, function(expression, attributeName) {
				var tmpMatch = IS_WHEN.exec(attributeName);
				if (tmpMatch) {
					var whenKey = (tmpMatch[1] ? '-' : '') + lowercase(tmpMatch[2]);
					whens[whenKey] = element.attr(attr.$attr[attributeName]);
				}
			});
			forEach(whens, function(expression, key) {
				whensExpFns[key] = $interpolate(expression.replace(BRACE, braceReplacement));

			});

			scope.$watch(numberExp, function ngPluralizeWatchAction(newVal) {
				var count = parseFloat(newVal);
				var countIsNaN = isNaN(count);

				if (!countIsNaN && !(count in whens)) {
					// If an explicit number rule such as 1, 2, 3... is defined, just use it.
					// Otherwise, check it against pluralization rules in $locale service.
					count = $locale.pluralCat(count - offset);
				}

				// If both `count` and `lastCount` are NaN, we don't need to re-register a watch.
				// In JS `NaN !== NaN`, so we have to explicitly check.
				if ((count !== lastCount) && !(countIsNaN && isNumber(lastCount) && isNaN(lastCount))) {
					watchRemover();
					var whenExpFn = whensExpFns[count];
					if (isUndefined(whenExpFn)) {
						if (newVal != null) {
							$log.debug("ngPluralize: no rule defined for '" + count + "' in " + whenExp);
						}
						watchRemover = noop;
						updateElementText();
					} else {
						watchRemover = scope.$watch(whenExpFn, updateElementText);
					}
					lastCount = count;
				}
			});

			function updateElementText(newText) {
				element.text(newText || '');
			}
		}
	};
}];

var ngRepeatDirective = ['$parse', '$animate', '$compile', function($parse, $animate, $compile) {
	var NG_REMOVED = '$$NG_REMOVED';
	var ngRepeatMinErr = minErr('ngRepeat');

	var updateScope = function(scope, index, valueIdentifier, value, keyIdentifier, key, arrayLength) {
		// TODO(perf): generate setters to shave off ~40ms or 1-1.5%
		scope[valueIdentifier] = value;
		if (keyIdentifier) scope[keyIdentifier] = key;
		scope.$index = index;
		scope.$first = (index === 0);
		scope.$last = (index === (arrayLength - 1));
		scope.$middle = !(scope.$first || scope.$last);
		// jshint bitwise: false
		scope.$odd = !(scope.$even = (index&1) === 0);
		// jshint bitwise: true
	};

	var getBlockStart = function(block) {
		return block.clone[0];
	};

	var getBlockEnd = function(block) {
		return block.clone[block.clone.length - 1];
	};

	return {
		restrict: 'A',
		multiElement: true,
		transclude: 'element',
		priority: 1000,
		terminal: true,
		$$tlb: true,
		compile: function ngRepeatCompile($element, $attr) {
			var expression = $attr.ngRepeat;
			var ngRepeatEndComment = $compile.$$createComment('end ngRepeat', expression);

			var match = expression.match(/^\s*([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+track\s+by\s+([\s\S]+?))?\s*$/);

			if (!match) {
				throw ngRepeatMinErr('iexp', "Expected expression in form of '_item_ in _collection_[ track by _id_]' but got '{0}'.",
						expression);
			}

			var lhs = match[1];
			var rhs = match[2];
			var aliasAs = match[3];
			var trackByExp = match[4];

			match = lhs.match(/^(?:(\s*[\$\w]+)|\(\s*([\$\w]+)\s*,\s*([\$\w]+)\s*\))$/);

			if (!match) {
				throw ngRepeatMinErr('iidexp', "'_item_' in '_item_ in _collection_' should be an identifier or '(_key_, _value_)' expression, but got '{0}'.",
						lhs);
			}
			var valueIdentifier = match[3] || match[1];
			var keyIdentifier = match[2];

			if (aliasAs && (!/^[$a-zA-Z_][$a-zA-Z0-9_]*$/.test(aliasAs) ||
					/^(null|undefined|this|\$index|\$first|\$middle|\$last|\$even|\$odd|\$parent|\$root|\$id)$/.test(aliasAs))) {
				throw ngRepeatMinErr('badident', "alias '{0}' is invalid --- must be a valid JS identifier which is not a reserved name.",
					aliasAs);
			}

			var trackByExpGetter, trackByIdExpFn, trackByIdArrayFn, trackByIdObjFn;
			var hashFnLocals = {$id: hashKey};

			if (trackByExp) {
				trackByExpGetter = $parse(trackByExp);
			} else {
				trackByIdArrayFn = function(key, value) {
					return hashKey(value);
				};
				trackByIdObjFn = function(key) {
					return key;
				};
			}

			return function ngRepeatLink($scope, $element, $attr, ctrl, $transclude) {

				if (trackByExpGetter) {
					trackByIdExpFn = function(key, value, index) {
						// assign key, value, and $index to the locals so that they can be used in hash functions
						if (keyIdentifier) hashFnLocals[keyIdentifier] = key;
						hashFnLocals[valueIdentifier] = value;
						hashFnLocals.$index = index;
						return trackByExpGetter($scope, hashFnLocals);
					};
				}

				// Store a list of elements from previous run. This is a hash where key is the item from the
				// iterator, and the value is objects with following properties.
				//   - scope: bound scope
				//   - element: previous element.
				//   - index: position
				//
				// We are using no-proto object so that we don't need to guard against inherited props via
				// hasOwnProperty.
				var lastBlockMap = createMap();

				//watch props
				$scope.$watchCollection(rhs, function ngRepeatAction(collection) {
					var index, length,
							previousNode = $element[0],     // node that cloned nodes should be inserted after
																							// initialized to the comment node anchor
							nextNode,
							// Same as lastBlockMap but it has the current state. It will become the
							// lastBlockMap on the next iteration.
							nextBlockMap = createMap(),
							collectionLength,
							key, value, // key/value of iteration
							trackById,
							trackByIdFn,
							collectionKeys,
							block,       // last object information {scope, element, id}
							nextBlockOrder,
							elementsToRemove;

					if (aliasAs) {
						$scope[aliasAs] = collection;
					}

					if (isArrayLike(collection)) {
						collectionKeys = collection;
						trackByIdFn = trackByIdExpFn || trackByIdArrayFn;
					} else {
						trackByIdFn = trackByIdExpFn || trackByIdObjFn;
						// if object, extract keys, in enumeration order, unsorted
						collectionKeys = [];
						for (var itemKey in collection) {
							if (hasOwnProperty.call(collection, itemKey) && itemKey.charAt(0) !== '$') {
								collectionKeys.push(itemKey);
							}
						}
					}

					collectionLength = collectionKeys.length;
					nextBlockOrder = new Array(collectionLength);

					// locate existing items
					for (index = 0; index < collectionLength; index++) {
						key = (collection === collectionKeys) ? index : collectionKeys[index];
						value = collection[key];
						trackById = trackByIdFn(key, value, index);
						if (lastBlockMap[trackById]) {
							// found previously seen block
							block = lastBlockMap[trackById];
							delete lastBlockMap[trackById];
							nextBlockMap[trackById] = block;
							nextBlockOrder[index] = block;
						} else if (nextBlockMap[trackById]) {
							// if collision detected. restore lastBlockMap and throw an error
							forEach(nextBlockOrder, function(block) {
								if (block && block.scope) lastBlockMap[block.id] = block;
							});
							throw ngRepeatMinErr('dupes',
									"Duplicates in a repeater are not allowed. Use 'track by' expression to specify unique keys. Repeater: {0}, Duplicate key: {1}, Duplicate value: {2}",
									expression, trackById, value);
						} else {
							// new never before seen block
							nextBlockOrder[index] = {id: trackById, scope: undefined, clone: undefined};
							nextBlockMap[trackById] = true;
						}
					}

					// remove leftover items
					for (var blockKey in lastBlockMap) {
						block = lastBlockMap[blockKey];
						elementsToRemove = getBlockNodes(block.clone);
						$animate.leave(elementsToRemove);
						if (elementsToRemove[0].parentNode) {
							// if the element was not removed yet because of pending animation, mark it as deleted
							// so that we can ignore it later
							for (index = 0, length = elementsToRemove.length; index < length; index++) {
								elementsToRemove[index][NG_REMOVED] = true;
							}
						}
						block.scope.$destroy();
					}

					// we are not using forEach for perf reasons (trying to avoid #call)
					for (index = 0; index < collectionLength; index++) {
						key = (collection === collectionKeys) ? index : collectionKeys[index];
						value = collection[key];
						block = nextBlockOrder[index];

						if (block.scope) {
							// if we have already seen this object, then we need to reuse the
							// associated scope/element

							nextNode = previousNode;

							// skip nodes that are already pending removal via leave animation
							do {
								nextNode = nextNode.nextSibling;
							} while (nextNode && nextNode[NG_REMOVED]);

							if (getBlockStart(block) != nextNode) {
								// existing item which got moved
								$animate.move(getBlockNodes(block.clone), null, previousNode);
							}
							previousNode = getBlockEnd(block);
							updateScope(block.scope, index, valueIdentifier, value, keyIdentifier, key, collectionLength);
						} else {
							// new item which we don't know about
							$transclude(function ngRepeatTransclude(clone, scope) {
								block.scope = scope;
								// http://jsperf.com/clone-vs-createcomment
								var endNode = ngRepeatEndComment.cloneNode(false);
								clone[clone.length++] = endNode;

								$animate.enter(clone, null, previousNode);
								previousNode = endNode;
								// Note: We only need the first/last node of the cloned nodes.
								// However, we need to keep the reference to the jqlite wrapper as it might be changed later
								// by a directive with templateUrl when its template arrives.
								block.clone = clone;
								nextBlockMap[block.id] = block;
								updateScope(block.scope, index, valueIdentifier, value, keyIdentifier, key, collectionLength);
							});
						}
					}
					lastBlockMap = nextBlockMap;
				});
			};
		}
	};
}];

var NG_HIDE_CLASS = 'ng-hide';
var NG_HIDE_IN_PROGRESS_CLASS = 'ng-hide-animate';

var ngShowDirective = ['$animate', function($animate) {
	return {
		restrict: 'A',
		multiElement: true,
		link: function(scope, element, attr) {
			scope.$watch(attr.ngShow, function ngShowWatchAction(value) {
				// we're adding a temporary, animation-specific class for ng-hide since this way
				// we can control when the element is actually displayed on screen without having
				// to have a global/greedy CSS selector that breaks when other animations are run.
				// Read: https://github.com/angular/angular.js/issues/9103#issuecomment-58335845
				$animate[value ? 'removeClass' : 'addClass'](element, NG_HIDE_CLASS, {
					tempClasses: NG_HIDE_IN_PROGRESS_CLASS
				});
			});
		}
	};
}];

var ngHideDirective = ['$animate', function($animate) {
	return {
		restrict: 'A',
		multiElement: true,
		link: function(scope, element, attr) {
			scope.$watch(attr.ngHide, function ngHideWatchAction(value) {
				// The comment inside of the ngShowDirective explains why we add and
				// remove a temporary class for the show/hide animation
				$animate[value ? 'addClass' : 'removeClass'](element,NG_HIDE_CLASS, {
					tempClasses: NG_HIDE_IN_PROGRESS_CLASS
				});
			});
		}
	};
}];

var ngStyleDirective = ngDirective(function(scope, element, attr) {
	scope.$watch(attr.ngStyle, function ngStyleWatchAction(newStyles, oldStyles) {
		if (oldStyles && (newStyles !== oldStyles)) {
			forEach(oldStyles, function(val, style) { element.css(style, '');});
		}
		if (newStyles) element.css(newStyles);
	}, true);
});

var ngSwitchDirective = ['$animate', '$compile', function($animate, $compile) {
	return {
		require: 'ngSwitch',

		// asks for $scope to fool the BC controller module
		controller: ['$scope', function ngSwitchController() {
		 this.cases = {};
		}],
		link: function(scope, element, attr, ngSwitchController) {
			var watchExpr = attr.ngSwitch || attr.on,
					selectedTranscludes = [],
					selectedElements = [],
					previousLeaveAnimations = [],
					selectedScopes = [];

			var spliceFactory = function(array, index) {
					return function() { array.splice(index, 1); };
			};

			scope.$watch(watchExpr, function ngSwitchWatchAction(value) {
				var i, ii;
				for (i = 0, ii = previousLeaveAnimations.length; i < ii; ++i) {
					$animate.cancel(previousLeaveAnimations[i]);
				}
				previousLeaveAnimations.length = 0;

				for (i = 0, ii = selectedScopes.length; i < ii; ++i) {
					var selected = getBlockNodes(selectedElements[i].clone);
					selectedScopes[i].$destroy();
					var promise = previousLeaveAnimations[i] = $animate.leave(selected);
					promise.then(spliceFactory(previousLeaveAnimations, i));
				}

				selectedElements.length = 0;
				selectedScopes.length = 0;

				if ((selectedTranscludes = ngSwitchController.cases['!' + value] || ngSwitchController.cases['?'])) {
					forEach(selectedTranscludes, function(selectedTransclude) {
						selectedTransclude.transclude(function(caseElement, selectedScope) {
							selectedScopes.push(selectedScope);
							var anchor = selectedTransclude.element;
							caseElement[caseElement.length++] = $compile.$$createComment('end ngSwitchWhen');
							var block = { clone: caseElement };

							selectedElements.push(block);
							$animate.enter(caseElement, anchor.parent(), anchor);
						});
					});
				}
			});
		}
	};
}];

var ngSwitchWhenDirective = ngDirective({
	transclude: 'element',
	priority: 1200,
	require: '^ngSwitch',
	multiElement: true,
	link: function(scope, element, attrs, ctrl, $transclude) {
		ctrl.cases['!' + attrs.ngSwitchWhen] = (ctrl.cases['!' + attrs.ngSwitchWhen] || []);
		ctrl.cases['!' + attrs.ngSwitchWhen].push({ transclude: $transclude, element: element });
	}
});

var ngSwitchDefaultDirective = ngDirective({
	transclude: 'element',
	priority: 1200,
	require: '^ngSwitch',
	multiElement: true,
	link: function(scope, element, attr, ctrl, $transclude) {
		ctrl.cases['?'] = (ctrl.cases['?'] || []);
		ctrl.cases['?'].push({ transclude: $transclude, element: element });
	 }
});

var ngTranscludeMinErr = minErr('ngTransclude');
var ngTranscludeDirective = ngDirective({
	restrict: 'EAC',
	link: function($scope, $element, $attrs, controller, $transclude) {

		if ($attrs.ngTransclude === $attrs.$attr.ngTransclude) {
			// If the attribute is of the form: `ng-transclude="ng-transclude"`
			// then treat it like the default
			$attrs.ngTransclude = '';
		}

		function ngTranscludeCloneAttachFn(clone) {
			if (clone.length) {
				$element.empty();
				$element.append(clone);
			}
		}

		if (!$transclude) {
			throw ngTranscludeMinErr('orphan',
			 'Illegal use of ngTransclude directive in the template! ' +
			 'No parent directive that requires a transclusion found. ' +
			 'Element: {0}',
			 startingTag($element));
		}

		// If there is no slot name defined or the slot name is not optional
		// then transclude the slot
		var slotName = $attrs.ngTransclude || $attrs.ngTranscludeSlot;
		$transclude(ngTranscludeCloneAttachFn, null, slotName);
	}
});

var scriptDirective = ['$templateCache', function($templateCache) {
	return {
		restrict: 'E',
		terminal: true,
		compile: function(element, attr) {
			if (attr.type == 'text/ng-template') {
				var templateUrl = attr.id,
						text = element[0].text;

				$templateCache.put(templateUrl, text);
			}
		}
	};
}];

var noopNgModelController = { $setViewValue: noop, $render: noop };

function chromeHack(optionElement) {
	// Workaround for https://code.google.com/p/chromium/issues/detail?id=381459
	// Adding an <option selected="selected"> element to a <select required="required"> should
	// automatically select the new element
	if (optionElement[0].hasAttribute('selected')) {
		optionElement[0].selected = true;
	}
}

var SelectController =
				['$element', '$scope', function($element, $scope) {

	var self = this,
			optionsMap = new HashMap();

	// If the ngModel doesn't get provided then provide a dummy noop version to prevent errors
	self.ngModelCtrl = noopNgModelController;

	// The "unknown" option is one that is prepended to the list if the viewValue
	// does not match any of the options. When it is rendered the value of the unknown
	// option is '? XXX ?' where XXX is the hashKey of the value that is not known.
	//
	// We can't just jqLite('<option>') since jqLite is not smart enough
	// to create it in <select> and IE barfs otherwise.
	self.unknownOption = jqLite(window.document.createElement('option'));
	self.renderUnknownOption = function(val) {
		var unknownVal = '? ' + hashKey(val) + ' ?';
		self.unknownOption.val(unknownVal);
		$element.prepend(self.unknownOption);
		$element.val(unknownVal);
	};

	$scope.$on('$destroy', function() {
		// disable unknown option so that we don't do work when the whole select is being destroyed
		self.renderUnknownOption = noop;
	});

	self.removeUnknownOption = function() {
		if (self.unknownOption.parent()) self.unknownOption.remove();
	};

	// Read the value of the select control, the implementation of this changes depending
	// upon whether the select can have multiple values and whether ngOptions is at work.
	self.readValue = function readSingleValue() {
		self.removeUnknownOption();
		return $element.val();
	};

	// Write the value to the select control, the implementation of this changes depending
	// upon whether the select can have multiple values and whether ngOptions is at work.
	self.writeValue = function writeSingleValue(value) {
		if (self.hasOption(value)) {
			self.removeUnknownOption();
			$element.val(value);
			if (value === '') self.emptyOption.prop('selected', true); // to make IE9 happy
		} else {
			if (value == null && self.emptyOption) {
				self.removeUnknownOption();
				$element.val('');
			} else {
				self.renderUnknownOption(value);
			}
		}
	};

	// Tell the select control that an option, with the given value, has been added
	self.addOption = function(value, element) {
		// Skip comment nodes, as they only pollute the `optionsMap`
		if (element[0].nodeType === NODE_TYPE_COMMENT) return;

		assertNotHasOwnProperty(value, '"option value"');
		if (value === '') {
			self.emptyOption = element;
		}
		var count = optionsMap.get(value) || 0;
		optionsMap.put(value, count + 1);
		self.ngModelCtrl.$render();
		chromeHack(element);
	};

	// Tell the select control that an option, with the given value, has been removed
	self.removeOption = function(value) {
		var count = optionsMap.get(value);
		if (count) {
			if (count === 1) {
				optionsMap.remove(value);
				if (value === '') {
					self.emptyOption = undefined;
				}
			} else {
				optionsMap.put(value, count - 1);
			}
		}
	};

	// Check whether the select control has an option matching the given value
	self.hasOption = function(value) {
		return !!optionsMap.get(value);
	};

	self.registerOption = function(optionScope, optionElement, optionAttrs, interpolateValueFn, interpolateTextFn) {

		if (interpolateValueFn) {
			// The value attribute is interpolated
			var oldVal;
			optionAttrs.$observe('value', function valueAttributeObserveAction(newVal) {
				if (isDefined(oldVal)) {
					self.removeOption(oldVal);
				}
				oldVal = newVal;
				self.addOption(newVal, optionElement);
			});
		} else if (interpolateTextFn) {
			// The text content is interpolated
			optionScope.$watch(interpolateTextFn, function interpolateWatchAction(newVal, oldVal) {
				optionAttrs.$set('value', newVal);
				if (oldVal !== newVal) {
					self.removeOption(oldVal);
				}
				self.addOption(newVal, optionElement);
			});
		} else {
			// The value attribute is static
			self.addOption(optionAttrs.value, optionElement);
		}

		optionElement.on('$destroy', function() {
			self.removeOption(optionAttrs.value);
			self.ngModelCtrl.$render();
		});
	};
}];

var selectDirective = function() {

	return {
		restrict: 'E',
		require: ['select', '?ngModel'],
		controller: SelectController,
		priority: 1,
		link: {
			pre: selectPreLink,
			post: selectPostLink
		}
	};

	function selectPreLink(scope, element, attr, ctrls) {

			// if ngModel is not defined, we don't need to do anything
			var ngModelCtrl = ctrls[1];
			if (!ngModelCtrl) return;

			var selectCtrl = ctrls[0];

			selectCtrl.ngModelCtrl = ngModelCtrl;

			// When the selected item(s) changes we delegate getting the value of the select control
			// to the `readValue` method, which can be changed if the select can have multiple
			// selected values or if the options are being generated by `ngOptions`
			element.on('change', function() {
				scope.$apply(function() {
					ngModelCtrl.$setViewValue(selectCtrl.readValue());
				});
			});

			// If the select allows multiple values then we need to modify how we read and write
			// values from and to the control; also what it means for the value to be empty and
			// we have to add an extra watch since ngModel doesn't work well with arrays - it
			// doesn't trigger rendering if only an item in the array changes.
			if (attr.multiple) {

				// Read value now needs to check each option to see if it is selected
				selectCtrl.readValue = function readMultipleValue() {
					var array = [];
					forEach(element.find('option'), function(option) {
						if (option.selected) {
							array.push(option.value);
						}
					});
					return array;
				};

				// Write value now needs to set the selected property of each matching option
				selectCtrl.writeValue = function writeMultipleValue(value) {
					var items = new HashMap(value);
					forEach(element.find('option'), function(option) {
						option.selected = isDefined(items.get(option.value));
					});
				};

				// we have to do it on each watch since ngModel watches reference, but
				// we need to work of an array, so we need to see if anything was inserted/removed
				var lastView, lastViewRef = NaN;
				scope.$watch(function selectMultipleWatch() {
					if (lastViewRef === ngModelCtrl.$viewValue && !equals(lastView, ngModelCtrl.$viewValue)) {
						lastView = shallowCopy(ngModelCtrl.$viewValue);
						ngModelCtrl.$render();
					}
					lastViewRef = ngModelCtrl.$viewValue;
				});

				// If we are a multiple select then value is now a collection
				// so the meaning of $isEmpty changes
				ngModelCtrl.$isEmpty = function(value) {
					return !value || value.length === 0;
				};

			}
		}

		function selectPostLink(scope, element, attrs, ctrls) {
			// if ngModel is not defined, we don't need to do anything
			var ngModelCtrl = ctrls[1];
			if (!ngModelCtrl) return;

			var selectCtrl = ctrls[0];

			// We delegate rendering to the `writeValue` method, which can be changed
			// if the select can have multiple selected values or if the options are being
			// generated by `ngOptions`.
			// This must be done in the postLink fn to prevent $render to be called before
			// all nodes have been linked correctly.
			ngModelCtrl.$render = function() {
				selectCtrl.writeValue(ngModelCtrl.$viewValue);
			};
		}
};

// The option directive is purely designed to communicate the existence (or lack of)
// of dynamically created (and destroyed) option elements to their containing select
// directive via its controller.
var optionDirective = ['$interpolate', function($interpolate) {
	return {
		restrict: 'E',
		priority: 100,
		compile: function(element, attr) {
			if (isDefined(attr.value)) {
				// If the value attribute is defined, check if it contains an interpolation
				var interpolateValueFn = $interpolate(attr.value, true);
			} else {
				// If the value attribute is not defined then we fall back to the
				// text content of the option element, which may be interpolated
				var interpolateTextFn = $interpolate(element.text(), true);
				if (!interpolateTextFn) {
					attr.$set('value', element.text());
				}
			}

			return function(scope, element, attr) {
				// This is an optimization over using ^^ since we don't want to have to search
				// all the way to the root of the DOM for every single option element
				var selectCtrlName = '$selectController',
						parent = element.parent(),
						selectCtrl = parent.data(selectCtrlName) ||
							parent.parent().data(selectCtrlName); // in case we are in optgroup

				if (selectCtrl) {
					selectCtrl.registerOption(scope, element, attr, interpolateValueFn, interpolateTextFn);
				}
			};
		}
	};
}];

var styleDirective = valueFn({
	restrict: 'E',
	terminal: false
});

var requiredDirective = function() {
	return {
		restrict: 'A',
		require: '?ngModel',
		link: function(scope, elm, attr, ctrl) {
			if (!ctrl) return;
			attr.required = true; // force truthy in case we are on non input element

			ctrl.$validators.required = function(modelValue, viewValue) {
				return !attr.required || !ctrl.$isEmpty(viewValue);
			};

			attr.$observe('required', function() {
				ctrl.$validate();
			});
		}
	};
};

var patternDirective = function() {
	return {
		restrict: 'A',
		require: '?ngModel',
		link: function(scope, elm, attr, ctrl) {
			if (!ctrl) return;

			var regexp, patternExp = attr.ngPattern || attr.pattern;
			attr.$observe('pattern', function(regex) {
				if (isString(regex) && regex.length > 0) {
					regex = new RegExp('^' + regex + '$');
				}

				if (regex && !regex.test) {
					throw minErr('ngPattern')('noregexp',
						'Expected {0} to be a RegExp but was {1}. Element: {2}', patternExp,
						regex, startingTag(elm));
				}

				regexp = regex || undefined;
				ctrl.$validate();
			});

			ctrl.$validators.pattern = function(modelValue, viewValue) {
				// HTML5 pattern constraint validates the input value, so we validate the viewValue
				return ctrl.$isEmpty(viewValue) || isUndefined(regexp) || regexp.test(viewValue);
			};
		}
	};
};

var maxlengthDirective = function() {
	return {
		restrict: 'A',
		require: '?ngModel',
		link: function(scope, elm, attr, ctrl) {
			if (!ctrl) return;

			var maxlength = -1;
			attr.$observe('maxlength', function(value) {
				var intVal = toInt(value);
				maxlength = isNaN(intVal) ? -1 : intVal;
				ctrl.$validate();
			});
			ctrl.$validators.maxlength = function(modelValue, viewValue) {
				return (maxlength < 0) || ctrl.$isEmpty(viewValue) || (viewValue.length <= maxlength);
			};
		}
	};
};

var minlengthDirective = function() {
	return {
		restrict: 'A',
		require: '?ngModel',
		link: function(scope, elm, attr, ctrl) {
			if (!ctrl) return;

			var minlength = 0;
			attr.$observe('minlength', function(value) {
				minlength = toInt(value) || 0;
				ctrl.$validate();
			});
			ctrl.$validators.minlength = function(modelValue, viewValue) {
				return ctrl.$isEmpty(viewValue) || viewValue.length >= minlength;
			};
		}
	};
};
