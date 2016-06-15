
function filterFilter() {
	return function(array, expression, comparator) {
		if (!isArrayLike(array)) {
			if (array == null) {
				return array;
			} else {
				throw minErr('filter')('notarray', 'Expected array but received: {0}', array);
			}
		}

		var expressionType = getTypeForFilter(expression);
		var predicateFn;
		var matchAgainstAnyProp;

		switch (expressionType) {
			case 'function':
				predicateFn = expression;
				break;
			case 'boolean':
			case 'null':
			case 'number':
			case 'string':
				matchAgainstAnyProp = true;
				//jshint -W086
			case 'object':
				//jshint +W086
				predicateFn = createPredicateFn(expression, comparator, matchAgainstAnyProp);
				break;
			default:
				return array;
		}

		return Array.prototype.filter.call(array, predicateFn);
	};
}

// Helper functions for `filterFilter`
function createPredicateFn(expression, comparator, matchAgainstAnyProp) {
	var shouldMatchPrimitives = isObject(expression) && ('$' in expression);
	var predicateFn;

	if (comparator === true) {
		comparator = equals;
	} else if (!isFunction(comparator)) {
		comparator = function(actual, expected) {
			if (isUndefined(actual)) {
				// No substring matching against `undefined`
				return false;
			}
			if ((actual === null) || (expected === null)) {
				// No substring matching against `null`; only match against `null`
				return actual === expected;
			}
			if (isObject(expected) || (isObject(actual) && !hasCustomToString(actual))) {
				// Should not compare primitives against objects, unless they have custom `toString` method
				return false;
			}

			actual = lowercase('' + actual);
			expected = lowercase('' + expected);
			return actual.indexOf(expected) !== -1;
		};
	}

	predicateFn = function(item) {
		if (shouldMatchPrimitives && !isObject(item)) {
			return deepCompare(item, expression.$, comparator, false);
		}
		return deepCompare(item, expression, comparator, matchAgainstAnyProp);
	};

	return predicateFn;
}

function deepCompare(actual, expected, comparator, matchAgainstAnyProp, dontMatchWholeObject) {
	var actualType = getTypeForFilter(actual);
	var expectedType = getTypeForFilter(expected);

	if ((expectedType === 'string') && (expected.charAt(0) === '!')) {
		return !deepCompare(actual, expected.substring(1), comparator, matchAgainstAnyProp);
	} else if (isArray(actual)) {
		// In case `actual` is an array, consider it a match
		// if ANY of it's items matches `expected`
		return actual.some(function(item) {
			return deepCompare(item, expected, comparator, matchAgainstAnyProp);
		});
	}

	switch (actualType) {
		case 'object':
			var key;
			if (matchAgainstAnyProp) {
				for (key in actual) {
					if ((key.charAt(0) !== '$') && deepCompare(actual[key], expected, comparator, true)) {
						return true;
					}
				}
				return dontMatchWholeObject ? false : deepCompare(actual, expected, comparator, false);
			} else if (expectedType === 'object') {
				for (key in expected) {
					var expectedVal = expected[key];
					if (isFunction(expectedVal) || isUndefined(expectedVal)) {
						continue;
					}

					var matchAnyProperty = key === '$';
					var actualVal = matchAnyProperty ? actual : actual[key];
					if (!deepCompare(actualVal, expectedVal, comparator, matchAnyProperty, matchAnyProperty)) {
						return false;
					}
				}
				return true;
			} else {
				return comparator(actual, expected);
			}
			break;
		case 'function':
			return false;
		default:
			return comparator(actual, expected);
	}
}

// Used for easily differentiating between `null` and actual `object`
function getTypeForFilter(val) {
	return (val === null) ? 'null' : typeof val;
}

var MAX_DIGITS = 22;
var DECIMAL_SEP = '.';
var ZERO_CHAR = '0';

currencyFilter.$inject = ['$locale'];
function currencyFilter($locale) {
	var formats = $locale.NUMBER_FORMATS;
	return function(amount, currencySymbol, fractionSize) {
		if (isUndefined(currencySymbol)) {
			currencySymbol = formats.CURRENCY_SYM;
		}

		if (isUndefined(fractionSize)) {
			fractionSize = formats.PATTERNS[1].maxFrac;
		}

		// if null or undefined pass it through
		return (amount == null)
				? amount
				: formatNumber(amount, formats.PATTERNS[1], formats.GROUP_SEP, formats.DECIMAL_SEP, fractionSize).
						replace(/\u00A4/g, currencySymbol);
	};
}

numberFilter.$inject = ['$locale'];
function numberFilter($locale) {
	var formats = $locale.NUMBER_FORMATS;
	return function(number, fractionSize) {

		// if null or undefined pass it through
		return (number == null)
				? number
				: formatNumber(number, formats.PATTERNS[0], formats.GROUP_SEP, formats.DECIMAL_SEP,
											 fractionSize);
	};
}

function parse(numStr) {
	var exponent = 0, digits, numberOfIntegerDigits;
	var i, j, zeros;

	// Decimal point?
	if ((numberOfIntegerDigits = numStr.indexOf(DECIMAL_SEP)) > -1) {
		numStr = numStr.replace(DECIMAL_SEP, '');
	}

	// Exponential form?
	if ((i = numStr.search(/e/i)) > 0) {
		// Work out the exponent.
		if (numberOfIntegerDigits < 0) numberOfIntegerDigits = i;
		numberOfIntegerDigits += +numStr.slice(i + 1);
		numStr = numStr.substring(0, i);
	} else if (numberOfIntegerDigits < 0) {
		// There was no decimal point or exponent so it is an integer.
		numberOfIntegerDigits = numStr.length;
	}

	// Count the number of leading zeros.
	for (i = 0; numStr.charAt(i) == ZERO_CHAR; i++) {}

	if (i == (zeros = numStr.length)) {
		// The digits are all zero.
		digits = [0];
		numberOfIntegerDigits = 1;
	} else {
		// Count the number of trailing zeros
		zeros--;
		while (numStr.charAt(zeros) == ZERO_CHAR) zeros--;

		// Trailing zeros are insignificant so ignore them
		numberOfIntegerDigits -= i;
		digits = [];
		// Convert string to array of digits without leading/trailing zeros.
		for (j = 0; i <= zeros; i++, j++) {
			digits[j] = +numStr.charAt(i);
		}
	}

	// If the number overflows the maximum allowed digits then use an exponent.
	if (numberOfIntegerDigits > MAX_DIGITS) {
		digits = digits.splice(0, MAX_DIGITS - 1);
		exponent = numberOfIntegerDigits - 1;
		numberOfIntegerDigits = 1;
	}

	return { d: digits, e: exponent, i: numberOfIntegerDigits };
}

function roundNumber(parsedNumber, fractionSize, minFrac, maxFrac) {
		var digits = parsedNumber.d;
		var fractionLen = digits.length - parsedNumber.i;

		// determine fractionSize if it is not specified; `+fractionSize` converts it to a number
		fractionSize = (isUndefined(fractionSize)) ? Math.min(Math.max(minFrac, fractionLen), maxFrac) : +fractionSize;

		// The index of the digit to where rounding is to occur
		var roundAt = fractionSize + parsedNumber.i;
		var digit = digits[roundAt];

		if (roundAt > 0) {
			// Drop fractional digits beyond `roundAt`
			digits.splice(Math.max(parsedNumber.i, roundAt));

			// Set non-fractional digits beyond `roundAt` to 0
			for (var j = roundAt; j < digits.length; j++) {
				digits[j] = 0;
			}
		} else {
			// We rounded to zero so reset the parsedNumber
			fractionLen = Math.max(0, fractionLen);
			parsedNumber.i = 1;
			digits.length = Math.max(1, roundAt = fractionSize + 1);
			digits[0] = 0;
			for (var i = 1; i < roundAt; i++) digits[i] = 0;
		}

		if (digit >= 5) {
			if (roundAt - 1 < 0) {
				for (var k = 0; k > roundAt; k--) {
					digits.unshift(0);
					parsedNumber.i++;
				}
				digits.unshift(1);
				parsedNumber.i++;
			} else {
				digits[roundAt - 1]++;
			}
		}

		// Pad out with zeros to get the required fraction length
		for (; fractionLen < Math.max(0, fractionSize); fractionLen++) digits.push(0);

		// Do any carrying, e.g. a digit was rounded up to 10
		var carry = digits.reduceRight(function(carry, d, i, digits) {
			d = d + carry;
			digits[i] = d % 10;
			return Math.floor(d / 10);
		}, 0);
		if (carry) {
			digits.unshift(carry);
			parsedNumber.i++;
		}
}

function formatNumber(number, pattern, groupSep, decimalSep, fractionSize) {

	if (!(isString(number) || isNumber(number)) || isNaN(number)) return '';

	var isInfinity = !isFinite(number);
	var isZero = false;
	var numStr = Math.abs(number) + '',
			formattedText = '',
			parsedNumber;

	if (isInfinity) {
		formattedText = '\u221e';
	} else {
		parsedNumber = parse(numStr);

		roundNumber(parsedNumber, fractionSize, pattern.minFrac, pattern.maxFrac);

		var digits = parsedNumber.d;
		var integerLen = parsedNumber.i;
		var exponent = parsedNumber.e;
		var decimals = [];
		isZero = digits.reduce(function(isZero, d) { return isZero && !d; }, true);

		// pad zeros for small numbers
		while (integerLen < 0) {
			digits.unshift(0);
			integerLen++;
		}

		// extract decimals digits
		if (integerLen > 0) {
			decimals = digits.splice(integerLen, digits.length);
		} else {
			decimals = digits;
			digits = [0];
		}

		// format the integer digits with grouping separators
		var groups = [];
		if (digits.length >= pattern.lgSize) {
			groups.unshift(digits.splice(-pattern.lgSize, digits.length).join(''));
		}
		while (digits.length > pattern.gSize) {
			groups.unshift(digits.splice(-pattern.gSize, digits.length).join(''));
		}
		if (digits.length) {
			groups.unshift(digits.join(''));
		}
		formattedText = groups.join(groupSep);

		// append the decimal digits
		if (decimals.length) {
			formattedText += decimalSep + decimals.join('');
		}

		if (exponent) {
			formattedText += 'e+' + exponent;
		}
	}
	if (number < 0 && !isZero) {
		return pattern.negPre + formattedText + pattern.negSuf;
	} else {
		return pattern.posPre + formattedText + pattern.posSuf;
	}
}

function padNumber(num, digits, trim, negWrap) {
	var neg = '';
	if (num < 0 || (negWrap && num <= 0)) {
		if (negWrap) {
			num = -num + 1;
		} else {
			num = -num;
			neg = '-';
		}
	}
	num = '' + num;
	while (num.length < digits) num = ZERO_CHAR + num;
	if (trim) {
		num = num.substr(num.length - digits);
	}
	return neg + num;
}

function dateGetter(name, size, offset, trim, negWrap) {
	offset = offset || 0;
	return function(date) {
		var value = date['get' + name]();
		if (offset > 0 || value > -offset) {
			value += offset;
		}
		if (value === 0 && offset == -12) value = 12;
		return padNumber(value, size, trim, negWrap);
	};
}

function dateStrGetter(name, shortForm, standAlone) {
	return function(date, formats) {
		var value = date['get' + name]();
		var propPrefix = (standAlone ? 'STANDALONE' : '') + (shortForm ? 'SHORT' : '');
		var get = uppercase(propPrefix + name);

		return formats[get][value];
	};
}

function timeZoneGetter(date, formats, offset) {
	var zone = -1 * offset;
	var paddedZone = (zone >= 0) ? "+" : "";

	paddedZone += padNumber(Math[zone > 0 ? 'floor' : 'ceil'](zone / 60), 2) +
								padNumber(Math.abs(zone % 60), 2);

	return paddedZone;
}

function getFirstThursdayOfYear(year) {
		// 0 = index of January
		var dayOfWeekOnFirst = (new Date(year, 0, 1)).getDay();
		// 4 = index of Thursday (+1 to account for 1st = 5)
		// 11 = index of *next* Thursday (+1 account for 1st = 12)
		return new Date(year, 0, ((dayOfWeekOnFirst <= 4) ? 5 : 12) - dayOfWeekOnFirst);
}

function getThursdayThisWeek(datetime) {
		return new Date(datetime.getFullYear(), datetime.getMonth(),
			// 4 = index of Thursday
			datetime.getDate() + (4 - datetime.getDay()));
}

function weekGetter(size) {
	 return function(date) {
			var firstThurs = getFirstThursdayOfYear(date.getFullYear()),
				 thisThurs = getThursdayThisWeek(date);

			var diff = +thisThurs - +firstThurs,
				 result = 1 + Math.round(diff / 6.048e8); // 6.048e8 ms per week

			return padNumber(result, size);
	 };
}

function ampmGetter(date, formats) {
	return date.getHours() < 12 ? formats.AMPMS[0] : formats.AMPMS[1];
}

function eraGetter(date, formats) {
	return date.getFullYear() <= 0 ? formats.ERAS[0] : formats.ERAS[1];
}

function longEraGetter(date, formats) {
	return date.getFullYear() <= 0 ? formats.ERANAMES[0] : formats.ERANAMES[1];
}

var DATE_FORMATS = {
	yyyy: dateGetter('FullYear', 4, 0, false, true),
		yy: dateGetter('FullYear', 2, 0, true, true),
		 y: dateGetter('FullYear', 1, 0, false, true),
	MMMM: dateStrGetter('Month'),
	 MMM: dateStrGetter('Month', true),
		MM: dateGetter('Month', 2, 1),
		 M: dateGetter('Month', 1, 1),
	LLLL: dateStrGetter('Month', false, true),
		dd: dateGetter('Date', 2),
		 d: dateGetter('Date', 1),
		HH: dateGetter('Hours', 2),
		 H: dateGetter('Hours', 1),
		hh: dateGetter('Hours', 2, -12),
		 h: dateGetter('Hours', 1, -12),
		mm: dateGetter('Minutes', 2),
		 m: dateGetter('Minutes', 1),
		ss: dateGetter('Seconds', 2),
		 s: dateGetter('Seconds', 1),
		 // while ISO 8601 requires fractions to be prefixed with `.` or `,`
		 // we can be just safely rely on using `sss` since we currently don't support single or two digit fractions
	 sss: dateGetter('Milliseconds', 3),
	EEEE: dateStrGetter('Day'),
	 EEE: dateStrGetter('Day', true),
		 a: ampmGetter,
		 Z: timeZoneGetter,
		ww: weekGetter(2),
		 w: weekGetter(1),
		 G: eraGetter,
		 GG: eraGetter,
		 GGG: eraGetter,
		 GGGG: longEraGetter
};

var DATE_FORMATS_SPLIT = /((?:[^yMLdHhmsaZEwG']+)|(?:'(?:[^']|'')*')|(?:E+|y+|M+|L+|d+|H+|h+|m+|s+|a|Z|G+|w+))(.*)/,
		NUMBER_STRING = /^\-?\d+$/;

dateFilter.$inject = ['$locale'];
function dateFilter($locale) {

	var R_ISO8601_STR = /^(\d{4})-?(\d\d)-?(\d\d)(?:T(\d\d)(?::?(\d\d)(?::?(\d\d)(?:\.(\d+))?)?)?(Z|([+-])(\d\d):?(\d\d))?)?$/;
										 // 1        2       3         4          5          6          7          8  9     10      11
	function jsonStringToDate(string) {
		var match;
		if (match = string.match(R_ISO8601_STR)) {
			var date = new Date(0),
					tzHour = 0,
					tzMin  = 0,
					dateSetter = match[8] ? date.setUTCFullYear : date.setFullYear,
					timeSetter = match[8] ? date.setUTCHours : date.setHours;

			if (match[9]) {
				tzHour = toInt(match[9] + match[10]);
				tzMin = toInt(match[9] + match[11]);
			}
			dateSetter.call(date, toInt(match[1]), toInt(match[2]) - 1, toInt(match[3]));
			var h = toInt(match[4] || 0) - tzHour;
			var m = toInt(match[5] || 0) - tzMin;
			var s = toInt(match[6] || 0);
			var ms = Math.round(parseFloat('0.' + (match[7] || 0)) * 1000);
			timeSetter.call(date, h, m, s, ms);
			return date;
		}
		return string;
	}

	return function(date, format, timezone) {
		var text = '',
				parts = [],
				fn, match;

		format = format || 'mediumDate';
		format = $locale.DATETIME_FORMATS[format] || format;
		if (isString(date)) {
			date = NUMBER_STRING.test(date) ? toInt(date) : jsonStringToDate(date);
		}

		if (isNumber(date)) {
			date = new Date(date);
		}

		if (!isDate(date) || !isFinite(date.getTime())) {
			return date;
		}

		while (format) {
			match = DATE_FORMATS_SPLIT.exec(format);
			if (match) {
				parts = concat(parts, match, 1);
				format = parts.pop();
			} else {
				parts.push(format);
				format = null;
			}
		}

		var dateTimezoneOffset = date.getTimezoneOffset();
		if (timezone) {
			dateTimezoneOffset = timezoneToOffset(timezone, dateTimezoneOffset);
			date = convertTimezoneToLocal(date, timezone, true);
		}
		forEach(parts, function(value) {
			fn = DATE_FORMATS[value];
			text += fn ? fn(date, $locale.DATETIME_FORMATS, dateTimezoneOffset)
								 : value === "''" ? "'" : value.replace(/(^'|'$)/g, '').replace(/''/g, "'");
		});

		return text;
	};
}

function jsonFilter() {
	return function(object, spacing) {
		if (isUndefined(spacing)) {
				spacing = 2;
		}
		return toJson(object, spacing);
	};
}

var lowercaseFilter = valueFn(lowercase);

var uppercaseFilter = valueFn(uppercase);

function limitToFilter() {
	return function(input, limit, begin) {
		if (Math.abs(Number(limit)) === Infinity) {
			limit = Number(limit);
		} else {
			limit = toInt(limit);
		}
		if (isNaN(limit)) return input;

		if (isNumber(input)) input = input.toString();
		if (!isArray(input) && !isString(input)) return input;

		begin = (!begin || isNaN(begin)) ? 0 : toInt(begin);
		begin = (begin < 0) ? Math.max(0, input.length + begin) : begin;

		if (limit >= 0) {
			return input.slice(begin, begin + limit);
		} else {
			if (begin === 0) {
				return input.slice(limit, input.length);
			} else {
				return input.slice(Math.max(0, begin + limit), begin);
			}
		}
	};
}

orderByFilter.$inject = ['$parse'];
function orderByFilter($parse) {
	return function(array, sortPredicate, reverseOrder) {

		if (array == null) return array;
		if (!isArrayLike(array)) {
			throw minErr('orderBy')('notarray', 'Expected array but received: {0}', array);
		}

		if (!isArray(sortPredicate)) { sortPredicate = [sortPredicate]; }
		if (sortPredicate.length === 0) { sortPredicate = ['+']; }

		var predicates = processPredicates(sortPredicate, reverseOrder);
		// Add a predicate at the end that evaluates to the element index. This makes the
		// sort stable as it works as a tie-breaker when all the input predicates cannot
		// distinguish between two elements.
		predicates.push({ get: function() { return {}; }, descending: reverseOrder ? -1 : 1});

		// The next three lines are a version of a Swartzian Transform idiom from Perl
		// (sometimes called the Decorate-Sort-Undecorate idiom)
		// See https://en.wikipedia.org/wiki/Schwartzian_transform
		var compareValues = Array.prototype.map.call(array, getComparisonObject);
		compareValues.sort(doComparison);
		array = compareValues.map(function(item) { return item.value; });

		return array;

		function getComparisonObject(value, index) {
			return {
				value: value,
				predicateValues: predicates.map(function(predicate) {
					return getPredicateValue(predicate.get(value), index);
				})
			};
		}

		function doComparison(v1, v2) {
			var result = 0;
			for (var index=0, length = predicates.length; index < length; ++index) {
				result = compare(v1.predicateValues[index], v2.predicateValues[index]) * predicates[index].descending;
				if (result) break;
			}
			return result;
		}
	};

	function processPredicates(sortPredicate, reverseOrder) {
		reverseOrder = reverseOrder ? -1 : 1;
		return sortPredicate.map(function(predicate) {
			var descending = 1, get = identity;

			if (isFunction(predicate)) {
				get = predicate;
			} else if (isString(predicate)) {
				if ((predicate.charAt(0) == '+' || predicate.charAt(0) == '-')) {
					descending = predicate.charAt(0) == '-' ? -1 : 1;
					predicate = predicate.substring(1);
				}
				if (predicate !== '') {
					get = $parse(predicate);
					if (get.constant) {
						var key = get();
						get = function(value) { return value[key]; };
					}
				}
			}
			return { get: get, descending: descending * reverseOrder };
		});
	}

	function isPrimitive(value) {
		switch (typeof value) {
			case 'number': 
			case 'boolean': 
			case 'string':
				return true;
			default:
				return false;
		}
	}

	function objectValue(value, index) {
		// If `valueOf` is a valid function use that
		if (typeof value.valueOf === 'function') {
			value = value.valueOf();
			if (isPrimitive(value)) return value;
		}
		// If `toString` is a valid function and not the one from `Object.prototype` use that
		if (hasCustomToString(value)) {
			value = value.toString();
			if (isPrimitive(value)) return value;
		}
		// We have a basic object so we use the position of the object in the collection
		return index;
	}

	function getPredicateValue(value, index) {
		var type = typeof value;
		if (value === null) {
			type = 'string';
			value = 'null';
		} else if (type === 'string') {
			value = value.toLowerCase();
		} else if (type === 'object') {
			value = objectValue(value, index);
		}
		return { value: value, type: type };
	}

	function compare(v1, v2) {
		var result = 0;
		if (v1.type === v2.type) {
			if (v1.value !== v2.value) {
				result = v1.value < v2.value ? -1 : 1;
			}
		} else {
			result = v1.type < v2.type ? -1 : 1;
		}
		return result;
	}
}


